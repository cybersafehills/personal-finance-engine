// Raw-events processor - turns `pending` capture `raw_financial_events` rows
// into `transactions` via the shared normalization pipeline
// (supabase/functions/_shared/ingestion-pipeline.ts). ADR 0009 §2.
//
// Two gates, both required (see lib.ts authorizeProcessorRequest):
//   DEVICE_PAIRING_V2 = enabled
//   RAW_EVENTS_PROCESSOR_SECRET (>= 32 chars) in the X-Processor-Secret header
// Missing either → 404 / 401 no-op. Safe to invoke on a schedule or by hand;
// every row it cannot finish is retried on the next tick.
//
// This function does NOT touch ingest-momo. `momo_messages` is reused as the
// raw-SMS store for the capture channel (source='iphone_capture_v2').

import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluatePolicies } from "../ingest-momo/policy-engine.ts";
import {
  normalizeInboundMessage,
  type PipelineDeps,
  type PipelineRoute,
} from "../_shared/ingestion-pipeline.ts";
import { authorizeProcessorRequest, decideParseStatus } from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const BATCH_LIMIT = 20;
const SMS_RECONCILIATION_ENABLED =
  Deno.env.get("SMS_RECONCILIATION_ENABLED") === "true";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

type ClaimedRow = {
  id: string;
  ingestion_connection_id: string;
  connector_installation_id: string | null;
  device_credential_id: string | null;
  financial_source_id: string | null;
  provider_key: string | null;
  payload_hash: string;
  received_at: string;
  raw_payload: Record<string, unknown>;
};

function buildDeps(): PipelineDeps {
  return {
    findActiveAccount: async (accountId) => {
      const { data } = await supabase
        .from("accounts")
        .select(
          "id, workspace_id, is_active, archived_at, financial_source_id, financial_sources(masked_identifier)",
        )
        .eq("id", accountId)
        .maybeSingle();
      if (!data) return null;
      const embedded = (data as Record<string, unknown>).financial_sources;
      const src = Array.isArray(embedded) ? embedded[0] : embedded;
      const masked =
        src && typeof src === "object" && "masked_identifier" in src
          ? ((src as { masked_identifier: string | null }).masked_identifier ??
            null)
          : null;
      return {
        id: data.id as string,
        workspace_id: data.workspace_id as string,
        is_active: data.is_active as boolean,
        archived_at: data.archived_at as string | null,
        financial_source_id: (data.financial_source_id as string | null) ??
          null,
        source_masked_identifier: masked,
      };
    },
    findTransactionByExternalId: async (externalId, workspaceId) => {
      const { data } = await supabase
        .from("transactions")
        .select("id")
        .eq("external_transaction_id", externalId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },
    classify: (input) => evaluatePolicies(supabase, input),
    computeFingerprint: async (args) => {
      const { data, error } = await supabase.rpc(
        "compute_transaction_fingerprint",
        args,
      );
      if (error || typeof data !== "string" || data.length === 0) return null;
      return data;
    },
    countDuplicateCandidates: async (fingerprint) => {
      const { data, error } = await supabase.rpc(
        "transaction_duplicate_candidates",
        { p_fingerprint: fingerprint, p_exclude_id: null },
      );
      if (error) return -1;
      return Array.isArray(data) ? data.length : 0;
    },
    insertTransaction: async (row) => {
      const { data, error } = await supabase
        .from("transactions")
        .insert(row)
        .select("id")
        .single();
      if (error || !data) {
        return { ok: false, message: error?.message ?? null };
      }
      return { ok: true, id: data.id as string };
    },
    finalizeRawEvent: async (rawEventId, patch) => {
      await supabase
        .from("raw_financial_events")
        .update({
          parse_status: patch.parseStatus,
          canonical_transaction_id: patch.canonicalTransactionId ?? null,
          ...(patch.financialSourceId
            ? { financial_source_id: patch.financialSourceId }
            : {}),
        })
        .eq("id", rawEventId);
    },
    markMomoMessage: async (id, status) => {
      await supabase
        .from("momo_messages")
        .update({ processing_status: status })
        .eq("id", id);
    },
    insertProcessingError: async (momoMessageId, e) => {
      await supabase.from("processing_errors").insert({
        momo_message_id: momoMessageId,
        stage: e.stage,
        error_code: e.errorCode,
        error_message: e.errorMessage,
        parser_version: "momo-parser-v1.1",
        error_details: e.details,
      });
    },
    insertCategoryHistory: async (
      { transactionId, workspaceId, classification },
    ) => {
      await supabase.from("transaction_category_history").insert({
        transaction_id: transactionId,
        workspace_id: workspaceId,
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
    },
    reconcilePaymentIntents: SMS_RECONCILIATION_ENABLED
      ? async (transactionId) => {
        const mode = Deno.env.get("SMS_RECONCILIATION_MODE") === "apply"
          ? "apply"
          : "observe";
        await supabase.rpc("reconcile_transaction_with_payment_intents", {
          p_transaction_id: transactionId,
          p_mode: mode,
        });
      }
      : undefined,
    sweepBudgetThresholds: async (workspaceId) => {
      await supabase.rpc("sweep_budget_thresholds", {
        p_workspace_id: workspaceId,
      });
    },
    touchConnection: async (connectionId) => {
      await supabase
        .from("ingestion_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", connectionId);
    },
  };
}

async function processRow(
  row: ClaimedRow,
  deps: PipelineDeps,
): Promise<"processed" | "superseded" | "failed" | "retried"> {
  const rawPayload = row.raw_payload ?? {};
  const rawMessage = typeof rawPayload.raw_message === "string"
    ? rawPayload.raw_message
    : "";
  const deviceReceivedAt = typeof rawPayload.device_received_at === "string"
    ? rawPayload.device_received_at
    : null;
  const attempts = typeof rawPayload.processor_attempts === "number"
    ? rawPayload.processor_attempts
    : 0;

  if (!rawMessage) {
    await supabase.from("raw_financial_events").update({
      parse_status: "failed",
    })
      .eq("id", row.id);
    return "failed";
  }

  // Route: account + workspace come from the legacy ingestion connection this
  // capture credential is mapped to (the same routing ingest-momo uses).
  const { data: conn } = await supabase
    .from("ingestion_connections")
    .select("account_id, workspace_id")
    .eq("id", row.ingestion_connection_id)
    .maybeSingle();
  if (!conn?.account_id) {
    await supabase.from("raw_financial_events").update({
      parse_status: "failed",
    })
      .eq("id", row.id);
    return "failed";
  }

  // Synthesize the momo_messages evidence row (reused as the raw-SMS store).
  const { data: mm, error: mmError } = await supabase
    .from("momo_messages")
    .insert({
      source: "iphone_capture_v2",
      ingestion_connection_id: row.ingestion_connection_id,
      raw_message: rawMessage,
      message_fingerprint: row.payload_hash,
      device_received_at: deviceReceivedAt,
      processing_status: "processing",
      parser_version: "momo-parser-v1.1",
      parse_attempts: 1,
      last_parse_attempt_at: new Date().toISOString(),
      metadata: { ingestion_source: "iphone_capture_v2" },
    })
    .select("id")
    .maybeSingle();

  let momoMessageId: string;
  if (mm?.id) {
    momoMessageId = mm.id as string;
  } else if (mmError?.code === "23505") {
    // The legacy Shortcut already ingested this exact message for this
    // connection. Point the evidence at that transaction and move on.
    const { data: existing } = await supabase
      .from("momo_messages")
      .select("id")
      .eq("ingestion_connection_id", row.ingestion_connection_id)
      .eq("message_fingerprint", row.payload_hash)
      .maybeSingle();
    const { data: txn } = existing?.id
      ? await supabase.from("transactions").select("id").eq(
        "momo_message_id",
        existing.id,
      ).maybeSingle()
      : { data: null };
    await supabase.from("raw_financial_events").update({
      parse_status: "superseded",
      canonical_transaction_id: (txn?.id as string | null) ?? null,
    }).eq("id", row.id);
    return "superseded";
  } else {
    await supabase.from("raw_financial_events").update({
      parse_status: attempts + 1 >= 5 ? "failed" : "pending",
      raw_payload: { ...rawPayload, processor_attempts: attempts + 1 },
    }).eq("id", row.id);
    return attempts + 1 >= 5 ? "failed" : "retried";
  }

  const route: PipelineRoute = {
    workspaceId: conn.workspace_id as string,
    accountId: conn.account_id as string,
    ingestionConnectionId: row.ingestion_connection_id,
    financialSourceId: row.financial_source_id,
    sourceMaskedIdentifier: null,
  };

  const result = await normalizeInboundMessage(
    {
      rawMessage,
      deviceReceivedAt,
      providerKey: row.provider_key ?? "mtn_momo",
    },
    route,
    { momoMessageId, rawFinancialEventId: row.id },
    deps,
  );

  const decision = decideParseStatus(result, attempts);
  const patch: Record<string, unknown> = { parse_status: decision.parseStatus };
  if (decision.bucket === "retried") {
    patch.raw_payload = { ...rawPayload, processor_attempts: attempts + 1 };
  }
  await supabase.from("raw_financial_events").update(patch).eq("id", row.id);
  return decision.bucket;
}

Deno.serve(async (request: Request) => {
  const auth = authorizeProcessorRequest(
    request,
    (k) => Deno.env.get(k) ?? undefined,
  );
  if (auth === "method_not_allowed") {
    return json({ ok: false, error: auth }, 405);
  }
  if (auth === "not_found") return json({ ok: false, error: "not_found" }, 404);
  if (auth !== "ok") {
    if (auth === "secret_not_configured") {
      console.error(
        "process-raw-events: RAW_EVENTS_PROCESSOR_SECRET is not set",
      );
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    await supabase.rpc("release_stale_processing_capture_events", {});

    const { data: rows, error } = await supabase.rpc(
      "claim_pending_capture_events",
      { p_limit: BATCH_LIMIT },
    );
    if (error) {
      console.error("claim_pending_capture_events failed:", error.message);
      return json({ ok: false, error: "claim_failed" }, 500);
    }

    const claimed = (rows ?? []) as ClaimedRow[];
    const deps = buildDeps();
    const tally = { processed: 0, superseded: 0, failed: 0, retried: 0 };
    for (const row of claimed) {
      try {
        tally[await processRow(row, deps)]++;
      } catch (err) {
        console.error(JSON.stringify({
          event: "process_row_threw",
          row_suffix: row.id.slice(-8),
          message: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        }));
        await supabase.from("raw_financial_events").update({
          parse_status: "pending",
        }).eq("id", row.id);
        tally.retried++;
      }
    }

    return json({ ok: true, claimed: claimed.length, ...tally });
  } catch (err) {
    console.error(JSON.stringify({
      event: "process_raw_events_unhandled",
      message: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    }));
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
