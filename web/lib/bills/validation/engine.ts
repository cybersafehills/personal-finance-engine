// The deterministic, explainable validation engine (master prompt §9).
// Pure and Deno-testable. Given a normalised extraction + the workspace
// policy + "today", it returns a closed list of findings, each with a
// stable ruleId and a detail string that names the specific problem.
// Never throws.

import {
  ARITHMETIC_TOLERANCE_MINOR,
  type Finding,
  type ValidationContext,
  type ValidationResult,
} from "./types";

function minor(ctx: ValidationContext, key: string): bigint | null {
  const v = ctx.fields[key]?.normalized;
  if (v == null || v === "") return null;
  if (!/^-?\d+$/.test(v)) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

function text(ctx: ValidationContext, key: string): string | null {
  const v = ctx.fields[key]?.normalized ?? ctx.fields[key]?.raw ?? null;
  return v && v.trim() ? v.trim() : null;
}

function anyText(ctx: ValidationContext, keys: string[]): string | null {
  for (const k of keys) {
    const v = text(ctx, k);
    if (v) return v;
  }
  return null;
}

function dateOf(ctx: ValidationContext, key: string): Date | null {
  const v = ctx.fields[key]?.normalized;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

function fmtMinor(n: bigint, currency: string | null): string {
  const digits = currency && ["RWF", "UGX", "TZS", "JPY", "BIF", "XAF", "XOF"].includes(currency)
    ? 0
    : 2;
  const neg = n < 0n;
  const abs = (neg ? -n : n).toString().padStart(digits + 1, "0");
  const whole = abs.slice(0, abs.length - digits) || "0";
  const frac = digits ? "." + abs.slice(abs.length - digits) : "";
  return `${neg ? "-" : ""}${currency ? currency + " " : ""}${whole}${frac}`;
}

const REQUIRED_KEY_MAP: Record<string, { keys: string[]; label: string; ruleId: string }> = {
  supplier: { keys: ["supplier_name"], label: "supplier", ruleId: "missing_supplier" },
  issue_date: { keys: ["issue_date", "receipt_date"], label: "issue date", ruleId: "missing_issue_date" },
  total: { keys: ["total"], label: "total", ruleId: "missing_total" },
  currency: { keys: ["currency"], label: "currency", ruleId: "missing_currency" },
  subtotal: { keys: ["subtotal"], label: "subtotal", ruleId: "missing_subtotal" },
  tax: { keys: ["tax_amount"], label: "tax amount", ruleId: "missing_tax" },
  document_number: {
    keys: ["invoice_number", "receipt_number", "credit_note_number"],
    label: "document number",
    ruleId: "missing_document_number",
  },
};

export function runValidation(ctx: ValidationContext): ValidationResult {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  const currency = text(ctx, "currency");
  const total = minor(ctx, "total");
  const subtotal = minor(ctx, "subtotal");
  const taxAmount = minor(ctx, "tax_amount");
  const discount = minor(ctx, "discount_amount");
  const charges = minor(ctx, "additional_charges");
  const amountPaid = minor(ctx, "amount_paid");
  const outstanding = minor(ctx, "outstanding_balance");
  const isCreditNote = ctx.docClass === "credit_note";

  // --- document class gates ------------------------------------------
  if (ctx.docClass === "quotation" || ctx.docClass === "proforma") {
    add({
      ruleId: "quotation_not_postable",
      severity: "needs_specialist",
      title: "This is a quotation, not a bill",
      detail:
        `The document was classified as a ${ctx.docClass}. Quotations and pro forma invoices are not completed expenses and cannot be posted to the ledger.`,
      affectedFields: [],
      blocksApproval: true,
      suggestedAction: "Keep as an informational document, or wait for the final invoice.",
    });
  }
  if (ctx.docClass === "unsupported" || ctx.docClass === "unknown" || ctx.docClass == null) {
    add({
      ruleId: "unsupported_document",
      severity: "blocking",
      title: "Document type could not be determined",
      detail:
        "The classifier could not confidently identify this as a supported financial document. It needs a person to confirm what it is.",
      affectedFields: [],
      blocksApproval: true,
      suggestedAction: "Review the document and set its type manually, or reject it.",
    });
  }
  if (isCreditNote) {
    add({
      ruleId: "credit_note_specialist_review",
      severity: "needs_specialist",
      title: "Credit note",
      detail:
        "Credit notes reduce a payable rather than adding an expense. They must be reviewed against the original invoice by someone who handles the ledger treatment.",
      affectedFields: [],
      blocksApproval: false,
      suggestedAction: "Route to an accountant / the person who manages payables.",
    });
  }

  // --- required fields ----------------------------------------------
  for (const key of ctx.policy.requiredFields) {
    const spec = REQUIRED_KEY_MAP[key];
    if (!spec) continue;
    if (!anyText(ctx, spec.keys)) {
      add({
        ruleId: spec.ruleId,
        severity: "blocking",
        title: `Missing ${spec.label}`,
        detail: `No ${spec.label} could be read from the document, and this workspace requires it before approval.`,
        affectedFields: spec.keys,
        blocksApproval: true,
        suggestedAction: `Add the ${spec.label} from the document.`,
      });
    }
  }

  // --- currency ----------------------------------------------------
  if (currency && !ctx.policy.supportedCurrencies.includes(currency)) {
    add({
      ruleId: "currency_unsupported",
      severity: "blocking",
      title: `Currency ${currency} is not configured`,
      detail: `The document is in ${currency}, which is not in this workspace's supported currencies (${ctx.policy.supportedCurrencies.join(", ") || "none"}).`,
      affectedFields: ["currency"],
      blocksApproval: true,
      suggestedAction: "Add the currency to the workspace's Bills settings, or handle this document manually.",
    });
  }

  // --- dates -----------------------------------------------------
  const now = new Date(ctx.now + "T00:00:00Z");
  const issue = dateOf(ctx, "issue_date") ?? dateOf(ctx, "receipt_date");
  const due = dateOf(ctx, "due_date");
  if (issue) {
    if (issue > addDays(now, ctx.policy.dateToleranceDays)) {
      add({
        ruleId: "future_issue_date",
        severity: "warning",
        title: "Issue date is in the future",
        detail: `The issue date (${ctx.fields.issue_date?.normalized ?? issue.toISOString().slice(0, 10)}) is after today (${ctx.now}).`,
        affectedFields: ["issue_date"],
        blocksApproval: false,
        suggestedAction: "Confirm the date on the document.",
      });
    }
    if (issue < addDays(now, -3650)) {
      add({
        ruleId: "implausibly_old_date",
        severity: "warning",
        title: "Issue date is more than 10 years ago",
        detail: `The issue date reads ${issue.toISOString().slice(0, 10)}. Check it was transcribed correctly.`,
        affectedFields: ["issue_date"],
        blocksApproval: false,
        suggestedAction: "Confirm the date on the document.",
      });
    }
  }
  if (issue && due && due < issue) {
    add({
      ruleId: "due_before_issue",
      severity: "warning",
      title: "Due date is before the issue date",
      detail: `Due ${due.toISOString().slice(0, 10)} is earlier than issued ${issue.toISOString().slice(0, 10)}.`,
      affectedFields: ["issue_date", "due_date"],
      blocksApproval: false,
      suggestedAction: "Check both dates on the document.",
    });
  }

  // --- amounts -------------------------------------------------
  if (total != null) {
    if (total < 0n && !isCreditNote) {
      add({
        ruleId: "negative_total",
        severity: "blocking",
        title: "Total is negative",
        detail: `The total reads ${fmtMinor(total, currency)}. A negative total is only expected on a credit note.`,
        affectedFields: ["total"],
        blocksApproval: true,
        suggestedAction: "Confirm the document type and the total.",
      });
    }
    if (total === 0n) {
      add({
        ruleId: "zero_value_total",
        severity: "warning",
        title: "Total is zero",
        detail: "The document's total is 0. Confirm this is intentional (e.g. a fully discounted or sample invoice).",
        affectedFields: ["total"],
        blocksApproval: false,
        suggestedAction: "Confirm the total on the document.",
      });
    }
  }

  if (total != null && subtotal != null && taxAmount != null) {
    const computed = subtotal + taxAmount + (charges ?? 0n) - (discount ?? 0n);
    const diff = computed - total;
    if (diff > ARITHMETIC_TOLERANCE_MINOR || diff < -ARITHMETIC_TOLERANCE_MINOR) {
      add({
        ruleId: "arithmetic_total_mismatch",
        severity: "blocking",
        title: "Totals don't add up",
        detail:
          `subtotal ${fmtMinor(subtotal, currency)} + tax ${fmtMinor(taxAmount, currency)}` +
          `${charges != null ? ` + charges ${fmtMinor(charges, currency)}` : ""}` +
          `${discount != null ? ` − discount ${fmtMinor(discount, currency)}` : ""}` +
          ` = ${fmtMinor(computed, currency)}, but the document's total is ${fmtMinor(total, currency)}.`,
        affectedFields: ["subtotal", "tax_amount", "total", "discount_amount", "additional_charges"],
        blocksApproval: true,
        suggestedAction: "Re-check the figures against the document; correct whichever was mis-read.",
      });
    }
  }

  if (subtotal != null && ctx.lineItems.length > 0) {
    let sum = 0n;
    let allPresent = true;
    for (const li of ctx.lineItems) {
      if (li.lineTotalMinor == null || !/^-?\d+$/.test(li.lineTotalMinor)) {
        allPresent = false;
        break;
      }
      sum += BigInt(li.lineTotalMinor);
    }
    if (allPresent) {
      const diff = sum - subtotal;
      if (diff > ARITHMETIC_TOLERANCE_MINOR || diff < -ARITHMETIC_TOLERANCE_MINOR) {
        add({
          ruleId: "line_items_subtotal_mismatch",
          severity: "warning",
          title: "Line items don't sum to the subtotal",
          detail: `The line totals add up to ${fmtMinor(sum, currency)}, but the subtotal is ${fmtMinor(subtotal, currency)}.`,
          affectedFields: ["subtotal"],
          blocksApproval: false,
          suggestedAction: "Check whether a line item was missed or mis-read.",
        });
      }
    }
  }

  if (total != null && amountPaid != null && amountPaid > total) {
    add({
      ruleId: "amount_paid_exceeds_total",
      severity: "warning",
      title: "Amount paid is more than the total",
      detail: `Amount paid ${fmtMinor(amountPaid, currency)} exceeds the total ${fmtMinor(total, currency)}.`,
      affectedFields: ["amount_paid", "total"],
      blocksApproval: false,
      suggestedAction: "Confirm the paid amount; a partial refund or overpayment may need separate handling.",
    });
  }

  if (total != null && amountPaid != null && outstanding != null) {
    const computed = total - amountPaid;
    const diff = computed - outstanding;
    if (diff > ARITHMETIC_TOLERANCE_MINOR || diff < -ARITHMETIC_TOLERANCE_MINOR) {
      add({
        ruleId: "outstanding_balance_mismatch",
        severity: "warning",
        title: "Outstanding balance doesn't match",
        detail: `total ${fmtMinor(total, currency)} − paid ${fmtMinor(amountPaid, currency)} = ${fmtMinor(computed, currency)}, but the stated balance due is ${fmtMinor(outstanding, currency)}.`,
        affectedFields: ["total", "amount_paid", "outstanding_balance"],
        blocksApproval: false,
        suggestedAction: "Check the balance figure on the document.",
      });
    }
  }

  // --- tax rate ------------------------------------------------
  const taxRate = text(ctx, "tax_rate");
  if (taxRate && ctx.policy.expectedTaxRates.length > 0 && !ctx.policy.expectedTaxRates.includes(taxRate)) {
    add({
      ruleId: "unexpected_tax_rate",
      severity: "warning",
      title: `Tax rate ${taxRate}% is unusual`,
      detail: `This workspace normally sees ${ctx.policy.expectedTaxRates.map((r) => r + "%").join(" or ")}. The document shows ${taxRate}%.`,
      affectedFields: ["tax_rate"],
      blocksApproval: false,
      suggestedAction: "Confirm the tax rate on the document.",
    });
  }

  // --- large amount ------------------------------------------
  if (
    total != null &&
    ctx.policy.largeAmountThresholdMinor != null &&
    /^\d+$/.test(ctx.policy.largeAmountThresholdMinor) &&
    currency === ctx.policy.largeAmountCurrency &&
    total >= BigInt(ctx.policy.largeAmountThresholdMinor)
  ) {
    add({
      ruleId: "large_amount",
      severity: "warning",
      title: "Large amount",
      detail: `The total ${fmtMinor(total, currency)} is at or above this workspace's large-amount threshold (${fmtMinor(BigInt(ctx.policy.largeAmountThresholdMinor), currency)}).`,
      affectedFields: ["total"],
      blocksApproval: false,
      suggestedAction: "Route to the approver required for high-value bills.",
    });
  }

  // --- extraction confidence -------------------------------
  for (const key of ["supplier_name", "total", "issue_date"]) {
    const c = ctx.fields[key]?.confidence;
    if (c != null && c < 0.5) {
      add({
        ruleId: `low_confidence_${key}`,
        severity: "warning",
        title: `Low confidence reading the ${key.replace(/_/g, " ")}`,
        detail: `The extractor reported ${Math.round(c * 100)}% confidence on this field. Verify it against the document.`,
        affectedFields: [key],
        blocksApproval: false,
        suggestedAction: "Check this field against the original.",
      });
    }
  }

  const blockingCount = findings.filter((f) => f.severity === "blocking").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  return { status: "succeeded", findings, blockingCount, warningCount, infoCount };
}
