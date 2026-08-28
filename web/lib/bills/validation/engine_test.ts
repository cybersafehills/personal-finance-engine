import { assert, assertEquals } from "jsr:@std/assert@1";
import { runValidation } from "./engine.ts";
import type { ValidationContext, ValidationField, ValidationPolicy } from "./types.ts";

const POLICY: ValidationPolicy = {
  supportedCurrencies: ["RWF", "USD", "EUR"],
  expectedTaxRates: [],
  requiredFields: ["supplier", "issue_date", "total", "currency"],
  largeAmountThresholdMinor: null,
  largeAmountCurrency: "RWF",
  dateToleranceDays: 3,
};

function f(normalized: string | null, extra: Partial<ValidationField> = {}): ValidationField {
  return { normalized, raw: normalized, currency: null, confidence: null, valueType: "string", ...extra };
}

function ctx(fields: Record<string, ValidationField>, over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    docClass: "supplier_invoice",
    fields,
    lineItems: [],
    policy: POLICY,
    now: "2026-08-28",
    ...over,
  };
}

const CLEAN = {
  supplier_name: f("Acme Ltd"),
  issue_date: f("2026-08-12"),
  currency: f("RWF"),
  subtotal: f("120000"),
  tax_amount: f("21600"),
  total: f("141600"),
  tax_rate: f("18"),
};

function ids(r: ReturnType<typeof runValidation>): string[] {
  return r.findings.map((x) => x.ruleId).sort();
}

Deno.test("a clean, self-consistent invoice produces no findings", () => {
  const r = runValidation(ctx({ ...CLEAN }));
  assertEquals(r.findings, []);
  assertEquals(r.blockingCount, 0);
});

Deno.test("arithmetic total mismatch is blocking and names the numbers", () => {
  const r = runValidation(ctx({ ...CLEAN, total: f("150000") }));
  assert(ids(r).includes("arithmetic_total_mismatch"));
  const finding = r.findings.find((x) => x.ruleId === "arithmetic_total_mismatch")!;
  assertEquals(finding.severity, "blocking");
  assert(finding.blocksApproval);
  assert(finding.detail.includes("141600") || finding.detail.includes("141,600"));
  assert(finding.detail.includes("150000") || finding.detail.includes("150,000"));
});

Deno.test("line items that don't sum to the subtotal is a warning", () => {
  const r = runValidation(
    ctx({ ...CLEAN }, {
      lineItems: [
        { lineTotalMinor: "72000", taxRate: "18", currency: "RWF" },
        { lineTotalMinor: "40000", taxRate: "18", currency: "RWF" },
      ],
    }),
  );
  assert(ids(r).includes("line_items_subtotal_mismatch"));
  assertEquals(r.findings.find((x) => x.ruleId === "line_items_subtotal_mismatch")!.severity, "warning");
});

Deno.test("a required field that's missing is blocking", () => {
  const withoutSupplier: Record<string, ValidationField> = { ...CLEAN };
  delete withoutSupplier.supplier_name;
  const r = runValidation(ctx(withoutSupplier));
  assert(ids(r).includes("missing_supplier"));
  assertEquals(r.findings.find((x) => x.ruleId === "missing_supplier")!.severity, "blocking");
});

Deno.test("an unsupported currency is blocking", () => {
  const r = runValidation(ctx({ ...CLEAN, currency: f("GBP") }));
  assert(ids(r).includes("currency_unsupported"));
});

Deno.test("future issue date and due-before-issue are warnings", () => {
  const r = runValidation(ctx({ ...CLEAN, issue_date: f("2027-01-01"), due_date: f("2026-06-01") }));
  const got = ids(r);
  assert(got.includes("future_issue_date"));
  assert(got.includes("due_before_issue"));
  assert(r.findings.every((x) => x.severity === "warning"));
});

Deno.test("a quotation cannot be posted (needs_specialist, blocks approval)", () => {
  const r = runValidation(ctx({ ...CLEAN }, { docClass: "quotation" }));
  const finding = r.findings.find((x) => x.ruleId === "quotation_not_postable")!;
  assertEquals(finding.severity, "needs_specialist");
  assert(finding.blocksApproval);
});

Deno.test("a negative total is blocking on an invoice but expected on a credit note", () => {
  const invoice = runValidation(
    ctx({ ...CLEAN, total: f("-141600"), subtotal: f("-120000"), tax_amount: f("-21600") }),
  );
  assert(ids(invoice).includes("negative_total"));

  const credit = runValidation(
    ctx({ ...CLEAN, total: f("-141600"), subtotal: f("-120000"), tax_amount: f("-21600") }, {
      docClass: "credit_note",
    }),
  );
  assert(!ids(credit).includes("negative_total"));
  assert(ids(credit).includes("credit_note_specialist_review"));
});

Deno.test("unexpected tax rate is a warning only when the policy has an expectation", () => {
  const noExpectation = runValidation(ctx({ ...CLEAN, tax_rate: f("7") }));
  assert(!ids(noExpectation).includes("unexpected_tax_rate"));

  const withExpectation = runValidation({
    ...ctx({ ...CLEAN, tax_rate: f("7") }),
    policy: { ...POLICY, expectedTaxRates: ["18", "0"] },
  });
  assert(ids(withExpectation).includes("unexpected_tax_rate"));
});

Deno.test("large-amount threshold produces a warning", () => {
  const r = runValidation({
    ...ctx({ ...CLEAN }),
    policy: { ...POLICY, largeAmountThresholdMinor: "100000", largeAmountCurrency: "RWF" },
  });
  assert(ids(r).includes("large_amount"));
});

Deno.test("amount paid exceeding the total is a warning", () => {
  const r = runValidation(ctx({ ...CLEAN, amount_paid: f("200000") }));
  assert(ids(r).includes("amount_paid_exceeds_total"));
});

Deno.test("low extraction confidence on a key field is a warning", () => {
  const r = runValidation(ctx({ ...CLEAN, total: f("141600", { confidence: 0.3 }) }));
  assert(ids(r).includes("low_confidence_total"));
});

Deno.test("an unknown doc class is blocking", () => {
  const r = runValidation(ctx({ ...CLEAN }, { docClass: "unknown" }));
  assert(ids(r).includes("unsupported_document"));
});

Deno.test("the engine never throws on empty input", () => {
  const r = runValidation(ctx({}, { docClass: null }));
  assertEquals(r.status, "succeeded");
  assert(r.findings.length > 0); // missing required fields + unsupported_document
});
