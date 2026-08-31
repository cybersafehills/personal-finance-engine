import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluatePolicies } from "./policy-engine.ts";
import { parseMomoMessage } from "./parser.ts";
import { normalizeMessage, sha256 } from "./parser-utils.ts";
import { jsonResponse } from "./responses.ts";
import { computeAccountingEffect } from "../_shared/accounting.ts";
import {
  buildRawFinancialEvent,
  deriveDedupeState,
  fingerprintArgs,
} from "./raw-event.ts";
import {
  acceptCanonicalShadow,
  acceptDeterministicEventRoute,
  authenticateCredential,
  canonicalIngestionEnabled,
  type CanonicalShadowRow,
  type DeterministicEventRouteRow,
  type IngestionConnectionRow,
  installationAdapterCanaryEnabled,
  mtnMomoAdapterEnabled,
  resolveAccountRoute,
} from "./connection-resolver.ts";
import {
  buildConnectorEventRouteDiscriminators,
} from "../_shared/connector-adapter.ts";
import {
  buildMtnMomoEventEnvelope,
  MTN_MOMO_SMS_CONNECTOR_KEY,
  mtnMomoSmsAdapter,
} from "./adapter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const CANONICAL_INGESTION_ENABLED = canonicalIngestionEnabled(
  Deno.env.get("ONELEDGER_CANONICAL_INGESTION"),
);
const MTN_MOMO_ADAPTER_ENABLED = mtnMomoAdapterEnabled(
  Deno.env.get("ONELEDGER_MTN_MOMO_ADAPTER"),
);

const PARSER_VERSION = "momo-parser-v1.1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

type ShadowObservationOutcome = "match" | "mismatch" | "resolver_error";
type AdapterRouteObservationOutcome =
  | "match"
  | "mismatch"
  | "resolver_error"
  | "envelope_error";

async function recordShadowObservation(
  connectionId: string,
  outcome: ShadowObservationOutcome,
  mismatchCode: string | null = null,
): Promise<void> {
  try {
    const { error } = await supabase.rpc(
      "record_connector_shadow_observation",
      {
        p_ingestion_connection_id: connectionId,
        p_outcome: outcome,
        p_mismatch_code: mismatchCode,
      },
    );

    if (error) {
      console.error(JSON.stringify({
        event: "canonical_shadow_observation_failed",
        outcome,
        connection_suffix: connectionId.slice(-8),
      }));
    }
  } catch {
    // Shadow telemetry is best-effort: it must never alter the routing
    // decision or expose database/credential details in logs.
    console.error(JSON.stringify({
      event: "canonical_shadow_observation_failed",
      outcome,
      connection_suffix: connectionId.slice(-8),
    }));
  }
}

async function recordAdapterRouteObservation(
  deviceCredentialId: string,
  outcome: AdapterRouteObservationOutcome,
  failureCode: string | null = null,
): Promise<void> {
  try {
    const { error } = await supabase.rpc(
      "record_connector_adapter_route_observation",
      {
        p_device_credential_id: deviceCredentialId,
        p_outcome: outcome,
        p_failure_code: failureCode,
      },
    );
    if (error) {
      console.error(JSON.stringify({
        event: "provider_adapter_route_observation_failed",
        outcome,
        credential_suffix: deviceCredentialId.slice(-8),
      }));
    }
  } catch {
    // Rollout telemetry is best-effort and must never decide event routing.
    console.error(JSON.stringify({
      event: "provider_adapter_route_observation_failed",
      outcome,
      credential_suffix: deviceCredentialId.slice(-8),
    }));
  }
}

Deno.serve(async (req: Request) => {
  try {
    // ========================================================
    // METHOD CONTROL
    // ========================================================

    if (req.method !== "POST") {
      return jsonResponse(
        {
          ok: false,
          error: "method_not_allowed",
        },
        405,
      );
    }

    // ========================================================
    // CUSTOM INGESTION AUTHENTICATION (Phase C: per-connection credentials)
    // ========================================================
    //
    // The presented secret is hashed and looked up through the selected
    // server-side resolver: legacy by default, canonical only after the exact
    // cutover flag is enabled. Either path resolves the compatibility
    // connection used by the rest of this reversible stage. Only the hash is
    // ever compared; the plaintext credential is never stored anywhere.
    //
    // A blank, malformed, revoked, or simply unrecognized credential all
    // fail identically (401 unauthorized) - the response never reveals
    // which of those was the case, so an attacker probing credentials
    // learns nothing beyond "wrong".

    const suppliedSecret = req.headers.get("x-ingest-key");

    const authResult = await authenticateCredential(suppliedSecret, {
      hash: sha256,
      findConnectionByCredentialHash: async (credentialHash) => {
        if (CANONICAL_INGESTION_ENABLED) {
          const { data, error } = await supabase.rpc(
            "resolve_canonical_ingestion_credential",
            { p_credential_hash: credentialHash },
          ).maybeSingle();

          if (error) {
            console.error(JSON.stringify({
              event: "canonical_credential_lookup_failed",
            }));
          }

          return (data as IngestionConnectionRow | null) ?? null;
        }

        const { data, error } = await supabase
          .from("ingestion_connections")
          .select(
            "id, workspace_id, account_id, status, connector_installation_id, device_credential_id",
          )
          .eq("credential_hash", credentialHash)
          .maybeSingle();

        if (error) {
          console.error("Ingestion connection lookup error:", error);
        }

        return (data as IngestionConnectionRow | null) ?? null;
      },
    });

    if (!authResult.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "unauthorized",
        },
        401,
      );
    }

    const connection = authResult.connection;

    // ========================================================
    // CANONICAL SHADOW ROUTE (Stage C)
    // ========================================================
    // Canonical installation/source/account provenance must resolve to exactly
    // the same route as the compatibility row. In the default-off cutover mode
    // above, canonical credentials authenticate first; this comparison remains
    // mandatory so rollback writes cannot drift. Reject before reading/storing
    // the payload on any disagreement; never silently choose one model.
    const { data: shadowData, error: shadowError } = await supabase.rpc(
      "resolve_canonical_ingestion_shadow",
      { p_ingestion_connection_id: connection.id },
    ).maybeSingle();
    const shadowResult = acceptCanonicalShadow(
      connection,
      (shadowData as CanonicalShadowRow | null) ?? null,
    );

    if (shadowError) {
      await recordShadowObservation(
        connection.id,
        "resolver_error",
        "shadow_resolver_error",
      );
      console.error(JSON.stringify({
        event: "canonical_route_mismatch",
        mismatch_code: "shadow_resolver_error",
        connection_suffix: connection.id.slice(-8),
      }));
      return jsonResponse({ ok: false, error: "routing_mismatch" }, 409);
    }

    if (!shadowResult.ok) {
      await recordShadowObservation(
        connection.id,
        "mismatch",
        shadowResult.mismatchCode,
      );
      console.error(JSON.stringify({
        event: "canonical_route_mismatch",
        mismatch_code: shadowResult.mismatchCode,
        connection_suffix: connection.id.slice(-8),
      }));
      return jsonResponse({ ok: false, error: "routing_mismatch" }, 409);
    }

    await recordShadowObservation(connection.id, "match");
    const canonicalRoute = shadowResult.route;

    let useMtnMomoAdapter = false;
    if (MTN_MOMO_ADAPTER_ENABLED) {
      const { data: installation, error: installationError } = await supabase
        .from("connector_installations")
        .select("connector_key")
        .eq("id", canonicalRoute.connectorInstallationId)
        .maybeSingle();

      if (installationError || !installation) {
        await recordAdapterRouteObservation(
          canonicalRoute.deviceCredentialId,
          "resolver_error",
          "adapter_installation_lookup_failed",
        );
        console.error(JSON.stringify({
          event: "provider_adapter_installation_lookup_failed",
          connection_suffix: connection.id.slice(-8),
        }));
        return jsonResponse({ ok: false, error: "routing_mismatch" }, 409);
      }
      useMtnMomoAdapter = installation.connector_key ===
        MTN_MOMO_SMS_CONNECTOR_KEY;

      if (useMtnMomoAdapter) {
        const { data: canary, error: canaryError } = await supabase
          .from("connector_adapter_canaries")
          .select("enabled")
          .eq(
            "connector_installation_id",
            canonicalRoute.connectorInstallationId,
          )
          .maybeSingle();

        if (canaryError) {
          await recordAdapterRouteObservation(
            canonicalRoute.deviceCredentialId,
            "resolver_error",
            "adapter_canary_lookup_failed",
          );
          console.error(JSON.stringify({
            event: "provider_adapter_canary_lookup_failed",
            connection_suffix: connection.id.slice(-8),
          }));
          return jsonResponse({ ok: false, error: "routing_mismatch" }, 409);
        }

        useMtnMomoAdapter = installationAdapterCanaryEnabled(canary);
      }
    }

    // ========================================================
    // BODY VALIDATION
    // ========================================================

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_json",
        },
        400,
      );
    }

    if (!body || typeof body !== "object") {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request_body",
        },
        400,
      );
    }

    const payload = body as Record<string, unknown>;

    const rawMessage = typeof payload.message === "string"
      ? payload.message.trim()
      : "";

    if (!rawMessage) {
      return jsonResponse(
        {
          ok: false,
          error: "missing_message",
        },
        400,
      );
    }

    if (rawMessage.length > 5000) {
      return jsonResponse(
        {
          ok: false,
          error: "message_too_large",
        },
        413,
      );
    }

    // ========================================================
    // BASIC FINANCIAL MESSAGE FILTER
    // ========================================================

    if (!/\bRWF\b/i.test(rawMessage)) {
      return jsonResponse(
        {
          ok: false,
          error: "not_rwf_message",
        },
        422,
      );
    }

    const normalizedMessage = normalizeMessage(rawMessage);

    const fingerprint = await sha256(normalizedMessage);

    const deviceReceivedAt = typeof payload.received_at === "string"
      ? payload.received_at
      : null;

    let adapterEnvelope: ReturnType<typeof buildMtnMomoEventEnvelope> | null =
      null;

    if (useMtnMomoAdapter) {
      try {
        if (
          (payload.source_ref != null &&
            typeof payload.source_ref !== "string") ||
          (payload.account_ref != null &&
            typeof payload.account_ref !== "string")
        ) {
          throw new Error("route_discriminator_invalid");
        }
        adapterEnvelope = buildMtnMomoEventEnvelope({
          message: rawMessage,
          receivedAt: deviceReceivedAt,
          sourceExternalRef: payload.source_ref ?? null,
          accountExternalRef: payload.account_ref ?? null,
          providerEventReference: fingerprint,
        });

        const discriminators = await buildConnectorEventRouteDiscriminators(
          adapterEnvelope,
        );
        const { data: routeData, error: routeError } = await supabase.rpc(
          "resolve_connector_event_route",
          {
            p_device_credential_id: canonicalRoute.deviceCredentialId,
            p_source_ref_hash: discriminators.source_ref_hash,
            p_account_ref_hash: discriminators.account_ref_hash,
          },
        ).maybeSingle();
        const acceptedRoute = acceptDeterministicEventRoute(
          connection,
          canonicalRoute,
          (routeData as DeterministicEventRouteRow | null) ?? null,
        );
        const mismatchCode = routeError
          ? "adapter_route_resolver_error"
          : !acceptedRoute.ok
          ? acceptedRoute.mismatchCode
          : null;

        if (mismatchCode) {
          await recordAdapterRouteObservation(
            canonicalRoute.deviceCredentialId,
            routeError ? "resolver_error" : "mismatch",
            mismatchCode,
          );
          console.error(JSON.stringify({
            event: "provider_adapter_route_mismatch",
            connector_key: adapterEnvelope.connector_key,
            mismatch_code: mismatchCode,
            connection_suffix: connection.id.slice(-8),
          }));
          return jsonResponse({ ok: false, error: "routing_mismatch" }, 409);
        }
        await recordAdapterRouteObservation(
          canonicalRoute.deviceCredentialId,
          "match",
        );
      } catch (error) {
        const failureCode = error instanceof Error ? error.message : "unknown";
        await recordAdapterRouteObservation(
          canonicalRoute.deviceCredentialId,
          "envelope_error",
          failureCode,
        );
        console.error(JSON.stringify({
          event: "provider_adapter_envelope_rejected",
          connector_key: "mtn_momo_sms_v1",
          error_code: failureCode,
          connection_suffix: connection.id.slice(-8),
        }));
        return jsonResponse(
          { ok: false, error: "invalid_route_envelope" },
          400,
        );
      }
    }

    // ========================================================
    // RAW MESSAGE DUPLICATE CHECK
    // ========================================================

    const { data: existingMessage, error: duplicateLookupError } =
      await supabase
        .from("momo_messages")
        .select("id, processing_status, parse_attempts")
        .eq("ingestion_connection_id", connection.id)
        .eq("message_fingerprint", fingerprint)
        .maybeSingle();

    if (duplicateLookupError) {
      console.error("Duplicate lookup error:", duplicateLookupError);

      return jsonResponse(
        {
          ok: false,
          error: "database_error",
        },
        500,
      );
    }

    // "failed" means this exact message was already stored as raw evidence
    // but never made it into a transaction (e.g. account resolution or the
    // ledger insert itself failed) - that is a retryable state, not a true
    // duplicate, so re-processing continues below using the existing row
    // rather than being turned away. Every other non-null status
    // (processed, needs_review, rejected, processing) represents either a
    // successful outcome or an in-flight/needs-human-input state and stays
    // a hard duplicate.
    const isRetryableFailure = existingMessage?.processing_status === "failed";

    if (existingMessage && !isRetryableFailure) {
      return jsonResponse({
        ok: true,
        status: "duplicate",
      });
    }

    // ========================================================
    // STORE RAW SMS EVIDENCE
    // ========================================================

    let momoMessageId: string;

    if (isRetryableFailure && existingMessage) {
      const { error: retryUpdateError } = await supabase
        .from("momo_messages")
        .update({
          processing_status: "processing",
          parse_attempts: Number(existingMessage.parse_attempts ?? 0) + 1,
          last_parse_attempt_at: new Date().toISOString(),
        })
        .eq("id", existingMessage.id);

      if (retryUpdateError) {
        console.error("Retry message update error:", retryUpdateError);

        return jsonResponse(
          {
            ok: false,
            error: "database_error",
          },
          500,
        );
      }

      momoMessageId = existingMessage.id;
    } else {
      const { data: insertedMessage, error: messageInsertError } =
        await supabase
          .from("momo_messages")
          .insert({
            source: "ios_shortcuts",
            ingestion_connection_id: connection.id,
            raw_message: rawMessage,
            message_fingerprint: fingerprint,
            device_received_at: deviceReceivedAt,
            processing_status: "processing",
            parser_version: PARSER_VERSION,
            parse_attempts: 1,
            last_parse_attempt_at: new Date().toISOString(),
            metadata: {
              ingestion_source: "iphone_shortcuts",
            },
          })
          .select("id")
          .single();

      if (messageInsertError?.code === "23505") {
        // Two deliveries for the same connection can pass the initial read
        // concurrently. The database constraint chooses one winner; the
        // loser is still a successful idempotent duplicate, not a 500.
        const { data: concurrentMessage } = await supabase
          .from("momo_messages")
          .select("id")
          .eq("ingestion_connection_id", connection.id)
          .eq("message_fingerprint", fingerprint)
          .maybeSingle();

        if (concurrentMessage) {
          return jsonResponse({ ok: true, status: "duplicate" });
        }
      }

      if (messageInsertError || !insertedMessage) {
        console.error("Raw message insert error:", messageInsertError);

        return jsonResponse(
          {
            ok: false,
            error: "database_error",
          },
          500,
        );
      }

      momoMessageId = insertedMessage.id;
    }

    // ========================================================
    // RAW FINANCIAL EVENT (Phase U: the evidence spine)
    // ========================================================
    //
    // Every inbound SMS is recorded as a raw_financial_events row -
    // upstream of, and independent from, whatever canonical transaction it
    // does or doesn't become (design doc §4.5: "evidence, never
    // discarded"). It is deduped on the normalized-message hash WITHIN the
    // authenticated connection. A retry from this connection reuses one row;
    // identical provider text belonging to another customer remains separate.
    // This is best-effort: a failure to write or reuse the
    // evidence row must never turn away an ingestion that otherwise
    // succeeds, so we log and carry on with a null id (parse_status is
    // advanced later, only if we have one).

    let rawFinancialEventId: string | null = null;

    {
      const rawEvent = buildRawFinancialEvent({
        rawMessage,
        payloadHash: fingerprint,
        deviceReceivedAt,
        ingestionConnectionId: connection.id,
        financialSourceId: canonicalRoute.financialSourceId,
        connectorInstallationId: canonicalRoute.connectorInstallationId,
        deviceCredentialId: canonicalRoute.deviceCredentialId,
        momoMessageId,
        parserVersion: PARSER_VERSION,
        now: new Date().toISOString(),
      });

      const { data: insertedEvent, error: rawEventInsertError } = await supabase
        .from("raw_financial_events")
        .insert(rawEvent)
        .select("id")
        .maybeSingle();

      if (insertedEvent?.id) {
        rawFinancialEventId = insertedEvent.id;
      } else if (rawEventInsertError?.code === "23505") {
        // Same evidence already recorded (retry, or redelivery): reuse it.
        const { data: existingEvent, error: existingEventError } =
          await supabase
            .from("raw_financial_events")
            .select("id")
            .eq("ingestion_connection_id", connection.id)
            .eq("payload_hash", fingerprint)
            .maybeSingle();

        if (existingEvent?.id) {
          rawFinancialEventId = existingEvent.id;
        } else if (existingEventError) {
          console.error(
            "Raw financial event re-lookup error (non-fatal):",
            existingEventError,
          );
        }
      } else if (rawEventInsertError) {
        console.error(
          "Raw financial event insert error (non-fatal):",
          rawEventInsertError,
        );
      }
    }

    // ========================================================
    // DETERMINISTIC TRANSACTION PARSING
    // ========================================================

    const parsed = adapterEnvelope
      ? (mtnMomoSmsAdapter.normalize({
        message: adapterEnvelope.payload.message,
        receivedAt: adapterEnvelope.payload.received_at,
        sourceExternalRef: adapterEnvelope.source_external_ref,
        accountExternalRef: adapterEnvelope.account_external_ref,
        providerEventReference: adapterEnvelope.provider_event_reference,
      })[0] ?? null)
      : parseMomoMessage(rawMessage);

    if (!parsed) {
      await supabase
        .from("momo_messages")
        .update({
          processing_status: "needs_review",
        })
        .eq("id", momoMessageId);

      if (rawFinancialEventId) {
        await supabase
          .from("raw_financial_events")
          .update({ parse_status: "rejected" })
          .eq("id", rawFinancialEventId);
      }

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "parsing",
          error_code: "UNRECOGNIZED_MOMO_FORMAT",
          error_message:
            "The SMS contains RWF but did not match a known MTN MoMo parser pattern.",
          parser_version: PARSER_VERSION,
          error_details: {
            message_fingerprint: fingerprint,
          },
        });

      return jsonResponse({
        ok: true,
        status: "needs_review",
      });
    }

    // ========================================================
    // MTN TRANSACTION-ID DUPLICATE CHECK
    // ========================================================

    if (parsed.external_transaction_id) {
      const { data: existingTransaction, error: transactionLookupError } =
        await supabase
          .from("transactions")
          .select("id")
          .eq(
            "external_transaction_id",
            parsed.external_transaction_id,
          )
          .eq("workspace_id", connection.workspace_id)
          .maybeSingle();

      if (transactionLookupError) {
        console.error(
          "Transaction duplicate lookup error:",
          transactionLookupError,
        );

        return jsonResponse(
          {
            ok: false,
            error: "database_error",
          },
          500,
        );
      }

      if (existingTransaction) {
        await supabase
          .from("momo_messages")
          .update({
            processing_status: "processed",
          })
          .eq("id", momoMessageId);

        if (rawFinancialEventId) {
          await supabase
            .from("raw_financial_events")
            .update({
              parse_status: "superseded",
              canonical_transaction_id: existingTransaction.id,
            })
            .eq("id", rawFinancialEventId);
        }

        return jsonResponse({
          ok: true,
          status: "duplicate_transaction",
        });
      }
    }

    // ========================================================
    // ACCOUNTING EFFECT (Phase 4.2) - the same canonical engine that
    // processed historical transactions in Phase 4.1, invoked inline here
    // rather than as a separate Edge Function. computeAccountingEffect()
    // never guesses: for the currently-parseable input shapes it always
    // returns a definite result, but is called defensively in case a
    // future parser change ever produces a status/direction it doesn't
    // recognize.
    // ========================================================

    let accountingEffect;
    try {
      accountingEffect = computeAccountingEffect({
        direction: parsed.direction,
        status: parsed.status,
        amount_rwf: parsed.amount_rwf,
        fee_rwf: parsed.fee_rwf,
      });
    } catch (accountingError) {
      console.error("Accounting computation error:", accountingError);

      await supabase
        .from("momo_messages")
        .update({
          processing_status: "failed",
        })
        .eq("id", momoMessageId);

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "database",
          error_code: "ACCOUNTING_COMPUTATION_FAILED",
          error_message:
            "The parsed transaction's accounting effect could not be computed.",
          parser_version: PARSER_VERSION,
          error_details: {
            message: accountingError instanceof Error
              ? accountingError.message
              : String(accountingError),
          },
        });

      return jsonResponse(
        {
          ok: false,
          error: "accounting_computation_failed",
        },
        500,
      );
    }

    // ========================================================
    // ACCOUNT/WORKSPACE RESOLUTION (Phase C: bound account routing)
    // ========================================================
    //
    // The matched ingestion_connections row is the sole source of truth for
    // where this transaction is attributed: workspace_id/account_id come
    // directly from that row, never re-derived, never client-supplied.
    // The account is re-checked live (not trusted from the connection row,
    // which may be stale) - if it has since been archived or deactivated,
    // the request fails closed rather than silently routing into an
    // account the workspace owner explicitly retired.

    const routeResult = await resolveAccountRoute(connection, {
      findActiveAccountById: async (accountId) => {
        const { data, error } = await supabase
          .from("accounts")
          .select(
            "id, workspace_id, is_active, archived_at, financial_source_id, financial_sources(masked_identifier)",
          )
          .eq("id", accountId)
          .maybeSingle();

        if (error) {
          console.error("Account lookup error:", error);
        }

        if (!data) {
          return null;
        }

        // PostgREST returns the embedded to-one either as an object or,
        // depending on how it resolves the relationship, a one-element
        // array - normalise both, and tolerate its absence entirely
        // (the seed account has no linked source).
        const embedded = (data as Record<string, unknown>).financial_sources;
        const source = Array.isArray(embedded) ? embedded[0] : embedded;
        const sourceMaskedIdentifier =
          source && typeof source === "object" && "masked_identifier" in source
            ? ((source as { masked_identifier: string | null })
              .masked_identifier ?? null)
            : null;

        return {
          id: data.id,
          workspace_id: data.workspace_id,
          is_active: data.is_active,
          archived_at: data.archived_at,
          financial_source_id: data.financial_source_id ?? null,
          source_masked_identifier: sourceMaskedIdentifier,
        };
      },
    });

    if (!routeResult.ok) {
      await supabase
        .from("momo_messages")
        .update({ processing_status: "failed" })
        .eq("id", momoMessageId);

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "database",
          error_code: "ACCOUNT_UNAVAILABLE",
          error_message:
            "This ingestion connection's bound account is archived or inactive; ingestion was refused rather than silently rerouted.",
          parser_version: PARSER_VERSION,
          error_details: {
            ingestion_connection_id: routeResult.connectionId,
          },
        });

      return jsonResponse(
        { ok: false, error: "account_unavailable" },
        409,
      );
    }

    const resolvedAccountId = routeResult.route.accountId;
    const resolvedWorkspaceId = routeResult.route.workspaceId;
    const ingestionConnectionId = routeResult.route.ingestionConnectionId;
    const resolvedFinancialSourceId = routeResult.route.financialSourceId;
    const resolvedSourceMaskedIdentifier =
      routeResult.route.sourceMaskedIdentifier;

    // ========================================================
    // CATEGORIZATION POLICY EVALUATION
    // ========================================================
    //
    // Runs after workspace resolution (not before, unlike the old
    // merchant-only classifier) because policies are workspace-scoped -
    // evaluating any earlier would mean either matching against every
    // workspace's policies indiscriminately or none at all.

    const evaluationStartedAt = performance.now();
    const classification = await evaluatePolicies(supabase, {
      workspaceId: resolvedWorkspaceId,
      direction: parsed.direction,
      amountRwf: parsed.amount_rwf,
      counterpartyName: parsed.counterparty_name,
      occurredAt: parsed.occurred_at,
      financialSourceId: resolvedFinancialSourceId,
    });
    const evaluationMs = performance.now() - evaluationStartedAt;

    // Structured, single-line log (not .error - this is routine, not a
    // failure) - the only "monitoring" this app's infrastructure can
    // consume today is Supabase's own Edge Function log viewer, which is
    // easiest to filter/alert on with one JSON object per decision rather
    // than free-form text.
    console.log(JSON.stringify({
      event: "categorization_decision",
      decision_status: classification.decisionStatus,
      matched_policy_id: classification.matchedPolicyId,
      confidence: classification.categoryConfidence,
      evaluation_ms: Math.round(evaluationMs),
    }));

    // ========================================================
    // TRANSACTION-LEVEL DUPLICATE DETECTION (Phase U)
    // ========================================================
    //
    // A normalized fingerprint (source + masked id + amount + currency +
    // direction + counterparty + occurred-at-to-the-minute) computed by
    // the same IMMUTABLE SQL function a reconciler would use. If another
    // non-merged transaction the ingestion role can see already carries
    // it, this row is stamped `possible_duplicate` and surfaced for human
    // review later - it is NEVER auto-merged or blocked here. The MTN
    // transaction-id check above still runs first and still short-circuits
    // exact redeliveries; this catches the near-duplicates that check
    // can't (e.g. the same payment seen once by SMS and once by a
    // statement import). Entirely best-effort: any RPC failure leaves the
    // row `unique` with a null fingerprint rather than failing ingestion.

    let dedupeFingerprint: string | null = null;
    let dedupeState: "unique" | "possible_duplicate" = "unique";

    try {
      const { data: fp, error: fpError } = await supabase.rpc(
        "compute_transaction_fingerprint",
        fingerprintArgs(parsed, {
          maskedIdentifier: resolvedSourceMaskedIdentifier,
        }),
      );

      if (fpError) {
        console.error("Fingerprint computation error (non-fatal):", fpError);
      } else if (typeof fp === "string" && fp.length > 0) {
        dedupeFingerprint = fp;

        const { data: candidates, error: candidatesError } = await supabase.rpc(
          "transaction_duplicate_candidates",
          { p_fingerprint: fp, p_exclude_id: null },
        );

        if (candidatesError) {
          console.error(
            "Duplicate-candidate lookup error (non-fatal):",
            candidatesError,
          );
        } else {
          dedupeState = deriveDedupeState(
            Array.isArray(candidates) ? candidates.length : 0,
          );
        }
      }
    } catch (fingerprintException) {
      console.error(
        "Duplicate detection threw (non-fatal):",
        fingerprintException,
      );
    }

    if (dedupeState === "possible_duplicate") {
      console.log(JSON.stringify({
        event: "possible_duplicate_ingested",
        dedupe_fingerprint: dedupeFingerprint,
      }));
    }

    // ========================================================
    // STRUCTURED FINANCIAL LEDGER INSERT
    // ========================================================
    //
    // Accounting fields are written in the SAME insert as every other
    // transaction field - never a separate update - so a row can never
    // exist mid-ingestion with source fields present but accounting
    // fields missing. net_effect_rwf is never written here; it remains a
    // database-generated column. If the computed effect ever disagreed
    // with what Postgres generates (the documented dormant incoming-
    // with-fee case - see accounting.ts), the database's own
    // transactions_net_effect_matches_new_accounting_fields constraint
    // rejects the insert outright, and that failure is handled by the
    // exact same error path as any other insert failure below - no
    // separate pre-check duplicates that invariant here.

    const { data: insertedTransaction, error: transactionInsertError } =
      await supabase
        .from("transactions")
        .insert({
          momo_message_id: momoMessageId,
          account_id: resolvedAccountId,
          workspace_id: resolvedWorkspaceId,
          ingestion_connection_id: ingestionConnectionId,
          // Phase U: provenance + duplicate-detection state. Routing is
          // unchanged - financial_source_id is the source the routed
          // account was linked to (nullable), not a new routing decision.
          financial_source_id: resolvedFinancialSourceId,
          dedupe_fingerprint: dedupeFingerprint,
          dedupe_state: dedupeState,
          external_transaction_id: parsed.external_transaction_id,
          source: "mtn_momo",
          transaction_type: parsed.transaction_type,
          direction: parsed.direction,
          status: parsed.status,
          currency: "RWF",
          amount_rwf: parsed.amount_rwf,
          fee_rwf: parsed.fee_rwf,
          balance_after_rwf: parsed.balance_after_rwf,
          counterparty_name: classification.normalizedMerchantName ??
            parsed.counterparty_name,
          counterparty_reference: parsed.counterparty_reference,
          occurred_at: parsed.occurred_at,
          category: classification.category,
          subcategory: classification.subcategory,
          category_source: classification.categorySource,
          category_confidence: classification.categoryConfidence,
          category_decision_status: classification.decisionStatus,
          suggested_category: classification.suggestedCategory,
          suggested_subcategory: classification.suggestedSubcategory,
          parser_version: PARSER_VERSION,
          metadata: {
            ...parsed.metadata,
            original_counterparty_name: parsed.counterparty_name,
            policy_applied: classification.categorySource === "rule",
          },
          principal_effect_rwf: accountingEffect.principal_effect_rwf,
          fee_effect_rwf: accountingEffect.fee_effect_rwf,
          settlement_state: accountingEffect.settlement_state,
          affects_balance: accountingEffect.affects_balance,
          effect_reason: accountingEffect.effect_reason,
        })
        .select("id")
        .single();

    if (transactionInsertError || !insertedTransaction) {
      console.error("Transaction insert error:", transactionInsertError);

      await supabase
        .from("momo_messages")
        .update({
          processing_status: "failed",
        })
        .eq("id", momoMessageId);

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "database",
          error_code: "TRANSACTION_INSERT_FAILED",
          error_message:
            "The parsed transaction could not be saved to the ledger.",
          parser_version: PARSER_VERSION,
          error_details: {
            postgres_message: transactionInsertError?.message ?? null,
          },
        });

      return jsonResponse(
        {
          ok: false,
          error: "transaction_store_failed",
        },
        500,
      );
    }

    // ========================================================
    // FINALISE THE RAW FINANCIAL EVENT (best-effort, non-fatal)
    // ========================================================
    //
    // The canonical transaction now exists; point the evidence row at it
    // and mark it normalized. The transaction is already durably stored -
    // a failure to update the evidence link must never undo or fail it.

    if (rawFinancialEventId) {
      const { error: rawEventFinalizeError } = await supabase
        .from("raw_financial_events")
        .update({
          parse_status: "normalized",
          canonical_transaction_id: insertedTransaction.id,
          financial_source_id: resolvedFinancialSourceId,
        })
        .eq("id", rawFinancialEventId);

      if (rawEventFinalizeError) {
        console.error(
          "Raw financial event finalize error (non-fatal):",
          rawEventFinalizeError,
        );
      }
    }

    // ========================================================
    // CATEGORY DECISION HISTORY (best-effort, non-fatal) - the
    // transaction itself is already durably stored above; a failure to
    // record how it was categorized must never undo or fail that.
    // ========================================================

    const { error: historyInsertError } = await supabase
      .from("transaction_category_history")
      .insert({
        transaction_id: insertedTransaction.id,
        workspace_id: resolvedWorkspaceId,
        new_category: classification.category,
        new_subcategory: classification.subcategory,
        new_category_source: classification.categorySource ?? "system",
        new_category_confidence: classification.categoryConfidence,
        new_decision_status: classification.decisionStatus,
        decision_reason: classification.explanation,
        policy_id: classification.matchedPolicyId,
        actor_type: "ingestion_engine",
        engine_version: "policy-engine@2",
      });

    if (historyInsertError) {
      console.error(
        "Category history insert error (non-fatal):",
        historyInsertError,
      );
    }

    // ========================================================
    // MARK RAW MESSAGE AS PROCESSED
    // ========================================================

    const { error: processedUpdateError } = await supabase
      .from("momo_messages")
      .update({
        processing_status: "processed",
      })
      .eq("id", momoMessageId);

    if (processedUpdateError) {
      console.error(
        "Processing-status update error:",
        processedUpdateError,
      );
    }

    // ========================================================
    // PAY & SERVICES: SMS-TO-INTENT RECONCILIATION (Phase 2b)
    // ========================================================
    //
    // Best-effort, non-fatal, and OFF unless SMS_RECONCILIATION_ENABLED
    // is explicitly "true" (opt-in - unlike the always-on Pay flags).
    // Deterministically links this just-ingested transaction to a
    // handed-off Assisted Quick Pay intent, if one matches. It NEVER
    // creates another transaction row (the row above is the only one);
    // ambiguity routes the intent to requires_reconciliation, never a
    // guess. The authoritative logic is the SECURITY DEFINER RPC
    // reconcile_transaction_with_payment_intents() (migration
    // 20260908000000); this call is just the trigger. A failure here
    // must never fail a request that already successfully ingested.

    if (Deno.env.get("SMS_RECONCILIATION_ENABLED") === "true") {
      const reconMode = Deno.env.get("SMS_RECONCILIATION_MODE") === "apply"
        ? "apply"
        : "observe";
      try {
        const { data: reconResult, error: reconError } = await supabase.rpc(
          "reconcile_transaction_with_payment_intents",
          { p_transaction_id: insertedTransaction.id, p_mode: reconMode },
        );
        if (reconError) {
          console.error(
            "Payment reconciliation error (non-fatal):",
            reconError,
          );
        } else {
          console.log(JSON.stringify({
            event: "payment_reconciliation",
            transaction_id: insertedTransaction.id,
            mode: reconMode,
            result: reconResult,
          }));
        }
      } catch (reconException) {
        console.error(
          "Payment reconciliation threw (non-fatal):",
          reconException,
        );
      }
    }

    // ========================================================
    // BUDGET THRESHOLD SWEEP (Phase V)
    // ========================================================
    //
    // A new settled outflow can push a budget past 75 / 90 / 100 / 110%.
    // sweep_budget_thresholds recomputes every active budget's total and
    // enqueues a notification only on a genuine upward crossing
    // (record_budget_threshold_crossing is idempotent). Best-effort and
    // non-fatal: a failure here must never fail a request that already
    // successfully ingested.

    try {
      const { error: sweepError } = await supabase.rpc(
        "sweep_budget_thresholds",
        { p_workspace_id: resolvedWorkspaceId },
      );
      if (sweepError) {
        console.error("Budget threshold sweep error (non-fatal):", sweepError);
      }
    } catch (sweepException) {
      console.error(
        "Budget threshold sweep threw (non-fatal):",
        sweepException,
      );
    }

    // ========================================================
    // RECORD CONNECTION ACTIVITY
    // ========================================================
    //
    // Best-effort only: last_used_at is informational (surfaced in the
    // Connections UI so a user can tell a connection is actually alive),
    // never load-bearing for authorization or routing, so a failure here
    // must never fail a request that already successfully ingested.

    const { error: lastUsedUpdateError } = await supabase
      .from("ingestion_connections")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", ingestionConnectionId);

    if (lastUsedUpdateError) {
      console.error(
        "last_used_at update error (non-fatal):",
        lastUsedUpdateError,
      );
    }

    // ========================================================
    // MINIMAL SUCCESS RESPONSE
    // ========================================================

    return jsonResponse({
      ok: true,
      status: "processed",
    });
  } catch (error) {
    console.error("Unhandled ingest-momo error:", error);

    return jsonResponse(
      {
        ok: false,
        error: "internal_error",
      },
      500,
    );
  }
});
