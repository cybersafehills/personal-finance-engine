import { createClient } from "npm:@supabase/supabase-js@2";
import { applyMerchantRule } from "./merchant-rules.ts";
import { parseMomoMessage } from "./parser.ts";
import { normalizeMessage, sha256 } from "./parser-utils.ts";
import { jsonResponse } from "./responses.ts";
import { computeAccountingEffect } from "../_shared/accounting.ts";
import {
  authenticateCredential,
  type IngestionConnectionRow,
  resolveAccountRoute,
} from "./connection-resolver.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
// TEMPORARY TRANSITION-ONLY: the Phase B global ingestion secret. Read only
// as a fallback when the presented credential doesn't match any row in
// ingestion_connections (Phase C's real per-connection credential model -
// see the auth block below). Remove this constant, the usingLegacyCredential
// fallback in the auth block, MOMO_INGEST_SECRET from the deployed function
// secrets, and the legacy branch of the ACCOUNT/WORKSPACE RESOLUTION block
// below, all together, once the production iPhone Shortcut is confirmed
// migrated to a per-connection credential and the old secret is explicitly
// revoked (a human-approval-gated production action - never automatic,
// never implied by this fallback existing).
const MOMO_INGEST_SECRET = Deno.env.get("MOMO_INGEST_SECRET") ?? "";

const PARSER_VERSION = "momo-parser-v1.1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

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
    // Replaces Phase B's single shared MOMO_INGEST_SECRET with per-
    // connection credentials: the presented secret is hashed and looked up
    // in ingestion_connections. A match resolves that specific connection's
    // workspace_id/account_id later in this function (see ACCOUNT
    // RESOLUTION below) - never re-derived from anything else the client
    // submits. Only the hash is ever compared; the plaintext credential is
    // never stored anywhere, here or in the database.
    //
    // A blank, malformed, revoked, or simply unrecognized credential all
    // fail identically (401 unauthorized) - the response never reveals
    // which of those was the case, so an attacker probing credentials
    // learns nothing beyond "wrong".

    const suppliedSecret = req.headers.get("x-ingest-key");

    const authResult = await authenticateCredential(suppliedSecret, {
      hash: sha256,
      legacySecret: MOMO_INGEST_SECRET,
      findConnectionByCredentialHash: async (credentialHash) => {
        const { data, error } = await supabase
          .from("ingestion_connections")
          .select("id, workspace_id, account_id, status")
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

    // ========================================================
    // RAW MESSAGE DUPLICATE CHECK
    // ========================================================

    const { data: existingMessage, error: duplicateLookupError } =
      await supabase
        .from("momo_messages")
        .select("id, processing_status")
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

    if (existingMessage) {
      return jsonResponse({
        ok: true,
        status: "duplicate",
      });
    }

    // ========================================================
    // STORE RAW SMS EVIDENCE
    // ========================================================

    const { data: insertedMessage, error: messageInsertError } = await supabase
      .from("momo_messages")
      .insert({
        source: "ios_shortcuts",
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

    const momoMessageId = insertedMessage.id;

    // ========================================================
    // DETERMINISTIC TRANSACTION PARSING
    // ========================================================

    const parsed = parseMomoMessage(rawMessage);

    if (!parsed) {
      await supabase
        .from("momo_messages")
        .update({
          processing_status: "needs_review",
        })
        .eq("id", momoMessageId);

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

        return jsonResponse({
          ok: true,
          status: "duplicate_transaction",
        });
      }
    }

    // ========================================================
    // MERCHANT RULE CLASSIFICATION
    // ========================================================

    const classification = await applyMerchantRule(
      supabase,
      parsed.counterparty_name,
    );

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
    // A matched ingestion_connections row is the sole source of truth for
    // where this transaction is attributed: workspace_id/account_id come
    // directly from that row, never re-derived, never client-supplied.
    // The account is re-checked live (not trusted from the connection row,
    // which may be stale) - if it has since been archived or deactivated,
    // the request fails closed rather than silently routing into an
    // account the workspace owner explicitly retired.
    //
    // The legacy (MOMO_INGEST_SECRET) path retains Phase B's exact
    // single-active-account resolver, unchanged, for as long as that
    // transition path exists - see the removal note above.

    const routeResult = await resolveAccountRoute(connection, {
      findActiveAccountById: async (accountId) => {
        const { data, error } = await supabase
          .from("accounts")
          .select("id, workspace_id, is_active, archived_at")
          .eq("id", accountId)
          .maybeSingle();

        if (error) {
          console.error("Account lookup error:", error);
        }

        return data ?? null;
      },
      findSingleLegacyActiveAccount: async () => {
        const { data: resolvedAccounts, error: accountLookupError } =
          await supabase
            .from("accounts")
            .select("id, workspace_id")
            .eq("is_active", true);

        if (accountLookupError) {
          console.error("Legacy account resolution error:", accountLookupError);
          return null;
        }

        if (resolvedAccounts.length === 0) return null;
        if (resolvedAccounts.length > 1) return "ambiguous";

        return {
          id: resolvedAccounts[0].id,
          workspace_id: resolvedAccounts[0].workspace_id,
          is_active: true,
          archived_at: null,
        };
      },
    });

    if (!routeResult.ok) {
      await supabase
        .from("momo_messages")
        .update({ processing_status: "failed" })
        .eq("id", momoMessageId);

      if (routeResult.reason === "account_unavailable") {
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

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "database",
          error_code: "ACCOUNT_RESOLUTION_FAILED",
          error_message:
            "Could not resolve exactly one active account to attribute this transaction to.",
          parser_version: PARSER_VERSION,
        });

      return jsonResponse(
        { ok: false, error: "account_resolution_failed" },
        500,
      );
    }

    const resolvedAccountId = routeResult.route.accountId;
    const resolvedWorkspaceId = routeResult.route.workspaceId;
    const ingestionConnectionId = routeResult.route.ingestionConnectionId;

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

    const { error: transactionInsertError } = await supabase
      .from("transactions")
      .insert({
        momo_message_id: momoMessageId,
        account_id: resolvedAccountId,
        workspace_id: resolvedWorkspaceId,
        ingestion_connection_id: ingestionConnectionId,
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
        parser_version: PARSER_VERSION,
        metadata: {
          ...parsed.metadata,
          original_counterparty_name: parsed.counterparty_name,
          merchant_rule_applied: classification.categorySource === "rule",
        },
        principal_effect_rwf: accountingEffect.principal_effect_rwf,
        fee_effect_rwf: accountingEffect.fee_effect_rwf,
        settlement_state: accountingEffect.settlement_state,
        affects_balance: accountingEffect.affects_balance,
        effect_reason: accountingEffect.effect_reason,
      });

    if (transactionInsertError) {
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
            postgres_message: transactionInsertError.message,
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
    // RECORD CONNECTION ACTIVITY
    // ========================================================
    //
    // Best-effort only: last_used_at is informational (surfaced in the
    // Connections UI so a user can tell a connection is actually alive),
    // never load-bearing for authorization or routing, so a failure here
    // must never fail a request that already successfully ingested.

    if (ingestionConnectionId) {
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
