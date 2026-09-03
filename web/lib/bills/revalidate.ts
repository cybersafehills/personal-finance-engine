import "server-only";
import type { supabaseServer } from "../supabase-server";
import { runValidation } from "./validation/engine";
import {
  RULESET_VERSION,
  type ValidationContext,
  type ValidationPolicy,
} from "./validation/types";
import { logBillError } from "./analytics";

// Shared validation runner used by both the cron worker (first pass) and
// the "re-check" server action (after a reviewer corrects a field). It
// prefers a user correction over the model's normalised value, builds the
// deterministic context, runs the pure engine, and persists via the
// service_role-only record_bill_validation RPC.

export const DEFAULT_VALIDATION_POLICY: ValidationPolicy = {
  supportedCurrencies: ["RWF", "USD", "EUR"],
  expectedTaxRates: [],
  requiredFields: ["supplier", "issue_date", "total", "currency"],
  largeAmountThresholdMinor: null,
  largeAmountCurrency: "RWF",
  dateToleranceDays: 3,
};

type Admin = ReturnType<typeof supabaseServer>;

export async function revalidateBillDocument(
  admin: Admin,
  billDocumentId: string,
  workspaceId: string,
): Promise<{ ok: boolean; blocking?: number; warning?: number }> {
  const { data: extraction } = await admin
    .from("bill_extractions")
    .select("id, doc_class")
    .eq("bill_document_id", billDocumentId)
    .eq("is_current", true)
    .maybeSingle();

  if (!extraction) {
    await admin.rpc("record_bill_validation", {
      payload: {
        bill_document_id: billDocumentId,
        workspace_id: workspaceId,
        status: "failed",
        error: { kind: "no_current_extraction" },
      },
    });
    return { ok: false };
  }

  const [{ data: fieldRows }, { data: lineRows }, { data: policyRow }] = await Promise.all([
    admin
      .from("bill_extracted_fields")
      .select(
        "field_key, normalized_value, raw_value, user_corrected_value, currency, confidence, value_type",
      )
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
  for (const r of (fieldRows ?? []) as Array<Record<string, unknown>>) {
    fields[r.field_key as string] = {
      // A correction wins over the model's normalisation.
      normalized: (r.user_corrected_value as string) ?? (r.normalized_value as string) ?? null,
      raw: (r.raw_value as string) ?? null,
      currency: (r.currency as string) ?? null,
      confidence: (r.confidence as number) ?? null,
      valueType: (r.value_type as string) ?? "string",
    };
  }

  const policy: ValidationPolicy = policyRow
    ? {
        supportedCurrencies:
          (policyRow.supported_currencies as string[]) ?? DEFAULT_VALIDATION_POLICY.supportedCurrencies,
        expectedTaxRates: ((policyRow.expected_tax_rates as Array<number | string>) ?? []).map((n) =>
          String(n),
        ),
        requiredFields:
          (policyRow.required_fields as string[]) ?? DEFAULT_VALIDATION_POLICY.requiredFields,
        largeAmountThresholdMinor:
          policyRow.large_amount_threshold_minor != null
            ? String(policyRow.large_amount_threshold_minor)
            : null,
        largeAmountCurrency: (policyRow.large_amount_currency as string) ?? "RWF",
        dateToleranceDays:
          (policyRow.date_tolerance_days as number) ?? DEFAULT_VALIDATION_POLICY.dateToleranceDays,
      }
    : DEFAULT_VALIDATION_POLICY;

  const ctx: ValidationContext = {
    docClass: extraction.doc_class,
    fields,
    lineItems: ((lineRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      lineTotalMinor: r.line_total_minor != null ? String(r.line_total_minor) : null,
      taxRate: r.tax_rate != null ? String(r.tax_rate) : null,
      currency: (r.currency as string) ?? null,
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
    return { ok: false };
  }

  const { error } = await admin.rpc("record_bill_validation", {
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
  if (error) {
    logBillError("record", error);
    return { ok: false };
  }
  return { ok: true, blocking: result.blockingCount, warning: result.warningCount };
}
