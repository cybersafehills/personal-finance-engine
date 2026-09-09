import { assertEquals } from "jsr:@std/assert@1";
import {
  defaultValidationContext,
  tallyValidation,
  validateNormalizedRow,
} from "./validation.ts";
import type { NormalizedImportRow } from "./mapping.ts";

function row(overrides: Partial<NormalizedImportRow>): NormalizedImportRow {
  return {
    occurred_at: "2026-08-01T00:00:00.000Z",
    amount_minor: 1000,
    direction: "out",
    description: "Groceries",
    merchant: null,
    external_reference: null,
    external_transaction_id: null,
    balance_minor: null,
    currency: "RWF",
    category: null,
    ...overrides,
  };
}

const NOW = new Date("2026-09-02T00:00:00.000Z");

Deno.test("a clean row is ready with no issues", () => {
  const v = validateNormalizedRow(
    row({}),
    defaultValidationContext({ now: NOW }),
  );
  assertEquals(v.status, "ready");
  assertEquals(v.issues, []);
});

Deno.test("a zero amount is blocking", () => {
  const v = validateNormalizedRow(
    row({ amount_minor: 0 }),
    defaultValidationContext({ now: NOW }),
  );
  assertEquals(v.status, "invalid");
  assertEquals(v.issues[0].code, "amount_zero");
});

Deno.test("an unsupported currency is a warning -> needs_review", () => {
  const v = validateNormalizedRow(
    row({ currency: "XAU" }),
    defaultValidationContext({ now: NOW }),
  );
  assertEquals(v.status, "needs_review");
  assertEquals(v.issues.some((i) => i.code === "currency_unsupported"), true);
});

Deno.test("a future date is a warning", () => {
  const v = validateNormalizedRow(
    row({ occurred_at: "2027-01-01T00:00:00.000Z" }),
    defaultValidationContext({ now: NOW }),
  );
  assertEquals(v.status, "needs_review");
  assertEquals(v.issues.some((i) => i.code === "date_future"), true);
});

Deno.test("a duplicate external id inside the batch is flagged on the second row", () => {
  const ctx = defaultValidationContext({ now: NOW });
  const first = validateNormalizedRow(
    row({ external_transaction_id: "TXN-1" }),
    ctx,
  );
  const second = validateNormalizedRow(
    row({ external_transaction_id: "TXN-1" }),
    ctx,
  );
  assertEquals(first.status, "ready");
  assertEquals(second.status, "needs_review");
  assertEquals(
    second.issues.some((i) => i.code === "external_id_duplicate"),
    true,
  );
});

Deno.test("tallyValidation counts by status", () => {
  assertEquals(
    tallyValidation(["ready", "ready", "needs_review", "invalid"]),
    { ready: 2, needsReview: 1, invalid: 1 },
  );
});

Deno.test("requireCategory: a categorised row passes, an uncategorised one is blocked", () => {
  const withCat = validateNormalizedRow(
    row({ category: "Utilities" }),
    defaultValidationContext({ now: NOW, requireCategory: true }),
  );
  assertEquals(withCat.status, "ready");

  const noCat = validateNormalizedRow(
    row({ category: null }),
    defaultValidationContext({ now: NOW, requireCategory: true }),
  );
  assertEquals(noCat.status, "invalid");
  assertEquals(
    noCat.issues.some((i) => i.code === "category_required"),
    true,
  );

  // Default context (plain transaction import) never blocks on category.
  const plain = validateNormalizedRow(
    row({ category: null }),
    defaultValidationContext({ now: NOW }),
  );
  assertEquals(plain.status, "ready");
});
