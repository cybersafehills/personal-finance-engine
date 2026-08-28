import "server-only";
import { supabaseServer } from "../supabase-server";
import { classifyAndExtract } from "./extraction/provider";
import { buildExtractionRecordPayload } from "./extraction";
import { runValidation } from "./validation/engine";
import type { ValidationContext, ValidationPolicy } from "./validation/types";
import { RULESET_VERSION } from "./validation/types";
import { logBillError } from "./analytics";

// The Bills & Expenses processing worker (master prompt §18). Invoked by
// the cron route app/api/cron/process-bill-documents; runs with the
// service-role client. Each document is processed independently and
// idempotently:
//   queued -> (claim) scanning -> classifying -> extracting
//         -> record_bill_extraction -> validating
//         -> runValidation -> record_bill_validation -> needs_review
// A document already at 'validating' (a previous tick claimed it, then
// died before the validation step) is picked up and just re-validated -
// record_bill_validation flips is_current so this is safe to repeat.
//
// Not wired to a scheduler yet (supabase/scheduling/). Does nothing
// unless BILLS_ENABLED and BILLS_EXTRACTION_ENABLED are both "true".

const DEFAULT_BATCH = 5;
const ORIGINAL_BUCKET = "bill-documents";

export type BillProcessingTickSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  validated: number;
  errors: string[];
};

function envEnabledOptIn(name: string): boolean {
  return process.env[name] === "true";
}

type Admin = ReturnType<typeof supabaseServer>;

export async function runBillProcessingTick(
  batchSize = DEFAULT_BATCH,
): Promise<BillProcessingTickSummary> {
  const summary: BillProcessingTickSummary = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    validated: 0,
    errors: [],
  };

  if (!envEnabledOptIn("BILLS_ENABLED") || !envEnabledOptIn("BILLS_EXTRACTION_ENABLED")) {
    return summary;
  }

  const admin = supabaseServer();

  const { data: candidates, error } = await admin
    .from("bill_documents")
    .select("id, workspace_id, storage_key, mime_type, status")
    .in("status", ["queued", "validating"])
    .order("uploaded_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    logBillError("record", error);
    summary.errors.push("queue_query_failed");
    return summary;
  }

  for (const doc of candidates ?? []) {
    try {
      if (doc.status === "queued") {
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
          await recordExtractionFailure(admin, doc.id, doc.workspace_id, { kind: "download_failed" });
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

        const { data: rpc, error: rpcError } = await admin.rpc("record_bill_extraction", { payload });
        if (rpcError) {
          logBillError("record", rpcError);
          await recordExtractionFailure(admin, doc.id, doc.workspace_id, { kind: "record_failed" });
          summary.failed += 1;
          continue;
        }
        const result = rpc as { ok: boolean; status?: string };
        if (result?.status !== "validating") {
          summary.failed += 1;
          continue;
        }
      }

      // Validation step (for a freshly-extracted doc, or a doc that was
      // stuck at 'validating').
      const validated = await validateDocument(admin, doc.id, doc.workspace_id);
      if (validated) summary.validated += 1;
      summary.succeeded += 1;
    } catch (err) {
      logBillError("record", err);
      summary.errors.push("doc_processing_exception");
      summary.failed += 1;
    }
  }

  return summary;
}

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

async function recordExtractionFailure(
  admin: Admin,
  billDocumentId: string,
  workspaceId: string,
  error: Record<string, unknown>,
): Promise<void> {
  await admin.rpc("record_bill_extraction", {
    payload: { bill_document_id: billDocumentId, workspace_id: workspaceId, status: "failed", error },
  });
}

const DEFAULT_POLICY: ValidationPolicy = {
  supportedCurrencies: ["RWF", "USD", "EUR"],
  expectedTaxRates: [],
  requiredFields: ["supplier", "issue_date", "total", "currency"],
  largeAmountThresholdMinor: null,
  largeAmountCurrency: "RWF",
  dateToleranceDays: 3,
};

async function validateDocument(
  admin: Admin,
  billDocumentId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data: extraction, error: exErr } = await admin
    .from("bill_extractions")
    .select("id, doc_class")
    .eq("bill_document_id", billDocumentId)
    .eq("is_current", true)
    .maybeSingle();

  if (exErr || !extraction) {
    // Nothing to validate against - still advance the document so a
    // reviewer sees it (record_bill_validation moves validating ->
    // needs_review even for a failed run).
    await admin.rpc("record_bill_validation", {
      payload: {
        bill_document_id: billDocumentId,
        workspace_id: workspaceId,
        status: "failed",
        error: { kind: "no_current_extraction" },
      },
    });
    return false;
  }

  const [{ data: fieldRows }, { data: lineRows }, { data: policyRow }] = await Promise.all([
    admin
      .from("bill_extracted_fields")
      .select("field_key, normalized_value, raw_value, currency, confidence, value_type")
      .eq("extraction_id", extraction.id),
    admin
      .from("bill_line_items")
      .select("line_total_minor, tax_rate, currency")
      .eq("extraction_id", extraction.id),
    admin
      .from("bill_processing_policies")
      .select(
        "supported_currencies, expected_tax_rates, required_fields, large_amount_threshold_minor, large_amount_currency, date_tolerance_days",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  const fields: ValidationContext["fields"] = {};
  for (const r of fieldRows ?? []) {
    fields[r.field_key] = {
      normalized: r.normalized_value,
      raw: r.raw_value,
      currency: r.currency,
      confidence: r.confidence,
      valueType: r.value_type,
    };
  }

  const policy: ValidationPolicy = policyRow
    ? {
        supportedCurrencies: policyRow.supported_currencies ?? DEFAULT_POLICY.supportedCurrencies,
        expectedTaxRates: (policyRow.expected_tax_rates ?? []).map((n: number | string) => String(n)),
        requiredFields: policyRow.required_fields ?? DEFAULT_POLICY.requiredFields,
        largeAmountThresholdMinor:
          policyRow.large_amount_threshold_minor != null
            ? String(policyRow.large_amount_threshold_minor)
            : null,
        largeAmountCurrency: policyRow.large_amount_currency ?? "RWF",
        dateToleranceDays: policyRow.date_tolerance_days ?? DEFAULT_POLICY.dateToleranceDays,
      }
    : DEFAULT_POLICY;

  const ctx: ValidationContext = {
    docClass: extraction.doc_class,
    fields,
    lineItems: (lineRows ?? []).map((r) => ({
      lineTotalMinor: r.line_total_minor != null ? String(r.line_total_minor) : null,
      taxRate: r.tax_rate != null ? String(r.tax_rate) : null,
      currency: r.currency,
    })),
    policy,
    now: new Date().toISOString().slice(0, 10),
  };

  let result;
  try {
    result = runValidation(ctx);
  } catch (err) {
    logBillError("record", err);
    await admin.rpc("record_bill_validation", {
      payload: {
        bill_document_id: billDocumentId,
        workspace_id: workspaceId,
        extraction_id: extraction.id,
        status: "failed",
        error: { kind: "engine_exception" },
      },
    });
    return false;
  }

  const { error: recErr } = await admin.rpc("record_bill_validation", {
    payload: {
      bill_document_id: billDocumentId,
      workspace_id: workspaceId,
      extraction_id: extraction.id,
      status: "succeeded",
      ruleset_version: RULESET_VERSION,
      findings: result.findings.map((f) => ({
        rule_id: f.ruleId,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        affected_fields: f.affectedFields,
        blocks_approval: f.blocksApproval,
        suggested_action: f.suggestedAction,
      })),
    },
  });
  if (recErr) {
    logBillError("record", recErr);
    return false;
  }
  return true;
}
