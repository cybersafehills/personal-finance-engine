import "server-only";
import { supabaseServer } from "../supabase-server";
import { classifyAndExtract } from "./extraction/provider";
import { buildExtractionRecordPayload } from "./extraction";
import { logBillError } from "./analytics";

// The Bills & Expenses extraction worker (master prompt §18). Invoked by
// the cron route app/api/cron/process-bill-documents; runs with the
// service-role client. Each document is processed independently and
// idempotently: a claim transition (queued -> scanning) means a
// concurrent or re-run tick skips it, and record_bill_extraction is the
// single atomic write of the result + lifecycle advance.
//
// Not wired to a scheduler yet - like the reporting engine's crons, pg_cron
// activation is a later, separate, manually-applied step
// (supabase/scheduling/). Calling the route repeatedly is always safe.

const DEFAULT_BATCH = 5;
const ORIGINAL_BUCKET = "bill-documents";

export type BillProcessingTickSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
};

function envEnabledOptIn(name: string): boolean {
  return process.env[name] === "true";
}

export async function runBillProcessingTick(
  batchSize = DEFAULT_BATCH,
): Promise<BillProcessingTickSummary> {
  const summary: BillProcessingTickSummary = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // A hard off-switch for the whole worker, independent of any
  // per-workspace allowlist (which is enforced at upload time - a doc
  // only reaches 'queued' from an extraction-enabled workspace).
  if (!envEnabledOptIn("BILLS_ENABLED") || !envEnabledOptIn("BILLS_EXTRACTION_ENABLED")) {
    return summary;
  }

  const admin = supabaseServer();

  const { data: queued, error } = await admin
    .from("bill_documents")
    .select("id, workspace_id, storage_key, mime_type")
    .eq("status", "queued")
    .order("uploaded_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    logBillError("record", error);
    summary.errors.push("queue_query_failed");
    return summary;
  }

  for (const doc of queued ?? []) {
    try {
      // Claim: queued -> scanning. If it didn't change, another tick has
      // it - skip.
      const claim = await systemTransition(admin, doc.id, "scanning");
      if (!claim || claim.changed === false || claim.ok === false) {
        summary.skipped += 1;
        continue;
      }
      summary.claimed += 1;

      await systemTransition(admin, doc.id, "classifying");
      await systemTransition(admin, doc.id, "extracting");

      const { data: blob, error: dlError } = await admin.storage
        .from(ORIGINAL_BUCKET)
        .download(doc.storage_key);
      if (dlError || !blob) {
        await recordFailure(admin, doc.id, doc.workspace_id, { kind: "download_failed" });
        summary.failed += 1;
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const call = await classifyAndExtract({ bytes, mimeType: doc.mime_type });
      const payload = buildExtractionRecordPayload({
        billDocumentId: doc.id,
        workspaceId: doc.workspace_id,
        call,
      });

      const { data: rpc, error: rpcError } = await admin.rpc("record_bill_extraction", {
        payload,
      });
      if (rpcError) {
        logBillError("record", rpcError);
        await recordFailure(admin, doc.id, doc.workspace_id, { kind: "record_failed" });
        summary.failed += 1;
        continue;
      }
      const result = rpc as { ok: boolean; status?: string };
      if (result?.status === "needs_review") summary.succeeded += 1;
      else summary.failed += 1;
    } catch (err) {
      logBillError("record", err);
      summary.errors.push("doc_processing_exception");
      try {
        await recordFailure(admin, doc.id, doc.workspace_id, { kind: "exception" });
      } catch {
        /* best effort */
      }
      summary.failed += 1;
    }
  }

  return summary;
}

type Admin = ReturnType<typeof supabaseServer>;

async function systemTransition(
  admin: Admin,
  id: string,
  toState: string,
): Promise<{ ok: boolean; changed?: boolean } | null> {
  const { data, error } = await admin.rpc("system_transition_bill_document", {
    p_id: id,
    p_to_state: toState,
    p_reason: null,
  });
  if (error) {
    logBillError("transition", error);
    return null;
  }
  return data as { ok: boolean; changed?: boolean };
}

async function recordFailure(
  admin: Admin,
  billDocumentId: string,
  workspaceId: string,
  error: Record<string, unknown>,
): Promise<void> {
  await admin.rpc("record_bill_extraction", {
    payload: {
      bill_document_id: billDocumentId,
      workspace_id: workspaceId,
      status: "failed",
      error,
    },
  });
}
