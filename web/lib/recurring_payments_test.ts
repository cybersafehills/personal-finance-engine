import { assertEquals } from "jsr:@std/assert@1";
import {
  detectRecurringPatterns,
  findMissingRecurringPayments,
  RecurringCandidateTransaction,
} from "./recurring-payments.ts";

function txn(overrides: Partial<RecurringCandidateTransaction>): RecurringCandidateTransaction {
  return {
    counterpartyKey: "netflix",
    category: "Entertainment",
    amountMinor: 10_000n,
    monthKey: "2026-06",
    dayOfMonth: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectRecurringPatterns
// ---------------------------------------------------------------------------

Deno.test("detectRecurringPatterns: recurring in all 3 months is detected", () => {
  const txns = [
    txn({ monthKey: "2026-05", dayOfMonth: 5 }),
    txn({ monthKey: "2026-06", dayOfMonth: 5 }),
    txn({ monthKey: "2026-07", dayOfMonth: 6 }),
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0].counterpartyKey, "netflix");
  assertEquals(patterns[0].monthsSeen, 3);
  assertEquals(patterns[0].typicalDayOfMonth, 5);
  assertEquals(patterns[0].typicalAmountMinor, 10_000n);
});

Deno.test("detectRecurringPatterns: appearing in only 1 of 3 months is not a pattern (default minMonthsSeen=2)", () => {
  const txns = [txn({ monthKey: "2026-07" })];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 0);
});

Deno.test("detectRecurringPatterns: 2 of 3 months meets the default threshold", () => {
  const txns = [
    txn({ monthKey: "2026-06" }),
    txn({ monthKey: "2026-07" }),
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0].monthsSeen, 2);
});

Deno.test("detectRecurringPatterns: different counterparties never merge into one pattern", () => {
  const txns = [
    txn({ counterpartyKey: "netflix", monthKey: "2026-06" }),
    txn({ counterpartyKey: "netflix", monthKey: "2026-07" }),
    txn({ counterpartyKey: "spotify", monthKey: "2026-06" }),
    txn({ counterpartyKey: "spotify", monthKey: "2026-07" }),
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 2);
});

Deno.test("detectRecurringPatterns: different categories for the same counterparty are separate patterns", () => {
  const txns = [
    txn({ category: "Entertainment", monthKey: "2026-06" }),
    txn({ category: "Entertainment", monthKey: "2026-07" }),
    txn({ category: "Utilities", monthKey: "2026-06" }),
    txn({ category: "Utilities", monthKey: "2026-07" }),
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 2);
});

Deno.test("detectRecurringPatterns: amounts within tolerance still count as the same pattern", () => {
  const txns = [
    txn({ monthKey: "2026-06", amountMinor: 10_000n }),
    txn({ monthKey: "2026-07", amountMinor: 10_500n }), // 5% diff, within default 15%
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 1);
});

Deno.test("detectRecurringPatterns: wildly varying amounts are rejected as not a reliable pattern", () => {
  const txns = [
    txn({ monthKey: "2026-06", amountMinor: 10_000n }),
    txn({ monthKey: "2026-07", amountMinor: 50_000n }), // 80% diff, outside tolerance
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 0);
});

Deno.test("detectRecurringPatterns: months outside the given completeMonthKeys are ignored", () => {
  const txns = [
    txn({ monthKey: "2026-01" }), // way outside scope
    txn({ monthKey: "2026-06" }),
    txn({ monthKey: "2026-07" }),
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0].monthsSeen, 2); // the January one is excluded
});

Deno.test("detectRecurringPatterns: multiple transactions in the same month for the same group count as one occurrence (earliest day kept)", () => {
  const txns = [
    txn({ monthKey: "2026-06", dayOfMonth: 5 }),
    txn({ monthKey: "2026-06", dayOfMonth: 20 }), // a second, unrelated Netflix charge same month
    txn({ monthKey: "2026-07", dayOfMonth: 5 }),
  ];
  const patterns = detectRecurringPatterns(txns, ["2026-05", "2026-06", "2026-07"]);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0].monthsSeen, 2); // still only 2 distinct months
});

Deno.test("detectRecurringPatterns: empty input yields no patterns", () => {
  assertEquals(detectRecurringPatterns([], ["2026-06", "2026-07"]), []);
});

// ---------------------------------------------------------------------------
// findMissingRecurringPayments
// ---------------------------------------------------------------------------

Deno.test("findMissingRecurringPayments: not yet flagged before the typical day + grace period", () => {
  const patterns = detectRecurringPatterns(
    [txn({ monthKey: "2026-06", dayOfMonth: 5 }), txn({ monthKey: "2026-07", dayOfMonth: 5 })],
    ["2026-05", "2026-06", "2026-07"],
  );
  // Typical day 5 + default 5-day grace = day 10; today is day 8, not yet overdue.
  const missing = findMissingRecurringPayments(patterns, [], 8);
  assertEquals(missing.length, 0);
});

Deno.test("findMissingRecurringPayments: flagged once past the typical day + grace period with nothing seen this month", () => {
  const patterns = detectRecurringPatterns(
    [txn({ monthKey: "2026-06", dayOfMonth: 5 }), txn({ monthKey: "2026-07", dayOfMonth: 5 })],
    ["2026-05", "2026-06", "2026-07"],
  );
  const missing = findMissingRecurringPayments(patterns, [], 15);
  assertEquals(missing.length, 1);
  assertEquals(missing[0].counterpartyKey, "netflix");
  assertEquals(missing[0].expectedByDayOfMonth, 10);
});

Deno.test("findMissingRecurringPayments: not flagged when a matching transaction already occurred this month", () => {
  const patterns = detectRecurringPatterns(
    [txn({ monthKey: "2026-06", dayOfMonth: 5 }), txn({ monthKey: "2026-07", dayOfMonth: 5 })],
    ["2026-05", "2026-06", "2026-07"],
  );
  const thisMonth = [txn({ monthKey: "2026-08", dayOfMonth: 6 })];
  const missing = findMissingRecurringPayments(patterns, thisMonth, 20);
  assertEquals(missing.length, 0);
});

Deno.test("findMissingRecurringPayments: an unrelated transaction this month does not clear the flag", () => {
  const patterns = detectRecurringPatterns(
    [txn({ monthKey: "2026-06", dayOfMonth: 5 }), txn({ monthKey: "2026-07", dayOfMonth: 5 })],
    ["2026-05", "2026-06", "2026-07"],
  );
  const thisMonth = [txn({ counterpartyKey: "spotify", monthKey: "2026-08", dayOfMonth: 6 })];
  const missing = findMissingRecurringPayments(patterns, thisMonth, 20);
  assertEquals(missing.length, 1);
});

Deno.test("findMissingRecurringPayments: a same-counterparty transaction with a wildly different amount does not clear the flag", () => {
  const patterns = detectRecurringPatterns(
    [txn({ monthKey: "2026-06", dayOfMonth: 5 }), txn({ monthKey: "2026-07", dayOfMonth: 5 })],
    ["2026-05", "2026-06", "2026-07"],
  );
  const thisMonth = [txn({ monthKey: "2026-08", dayOfMonth: 6, amountMinor: 100_000n })];
  const missing = findMissingRecurringPayments(patterns, thisMonth, 20);
  assertEquals(missing.length, 1);
});

Deno.test("findMissingRecurringPayments: custom grace period is honored", () => {
  const patterns = detectRecurringPatterns(
    [txn({ monthKey: "2026-06", dayOfMonth: 5 }), txn({ monthKey: "2026-07", dayOfMonth: 5 })],
    ["2026-05", "2026-06", "2026-07"],
  );
  assertEquals(findMissingRecurringPayments(patterns, [], 8, 10).length, 0); // day 5+10=15, today 8: not yet
  assertEquals(findMissingRecurringPayments(patterns, [], 16, 10).length, 1); // day 5+10=15, today 16: overdue
});

Deno.test("findMissingRecurringPayments: no patterns yields nothing missing", () => {
  assertEquals(findMissingRecurringPayments([], [], 28), []);
});
