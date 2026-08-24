import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  computeVariableIncomeRecommendation,
  lastNCompleteMonthKeys,
  shiftMonthKey,
} from "./budget-math.ts";

// ---------------------------------------------------------------------------
// shiftMonthKey
// ---------------------------------------------------------------------------

Deno.test("shiftMonthKey: shifting by zero returns the same month", () => {
  assertEquals(shiftMonthKey("2026-08", 0), "2026-08");
});

Deno.test("shiftMonthKey: shifting back within a year", () => {
  assertEquals(shiftMonthKey("2026-08", -1), "2026-07");
  assertEquals(shiftMonthKey("2026-08", -3), "2026-05");
});

Deno.test("shiftMonthKey: shifting back across a year boundary", () => {
  assertEquals(shiftMonthKey("2026-01", -1), "2025-12");
  assertEquals(shiftMonthKey("2026-02", -3), "2025-11");
});

Deno.test("shiftMonthKey: shifting forward across a year boundary", () => {
  assertEquals(shiftMonthKey("2025-12", 1), "2026-01");
});

Deno.test("shiftMonthKey: rejects a malformed month key", () => {
  assertThrows(() => shiftMonthKey("2026-8", -1), RangeError);
  assertThrows(() => shiftMonthKey("not-a-month", -1), RangeError);
});

// ---------------------------------------------------------------------------
// lastNCompleteMonthKeys
// ---------------------------------------------------------------------------

Deno.test("lastNCompleteMonthKeys: the 3 months before August 2026, oldest first, excluding August itself", () => {
  assertEquals(lastNCompleteMonthKeys("2026-08", 3), ["2026-05", "2026-06", "2026-07"]);
});

Deno.test("lastNCompleteMonthKeys: crossing a year boundary", () => {
  assertEquals(lastNCompleteMonthKeys("2026-02", 3), ["2025-11", "2025-12", "2026-01"]);
});

Deno.test("lastNCompleteMonthKeys: count of zero yields no months", () => {
  assertEquals(lastNCompleteMonthKeys("2026-08", 0), []);
});

Deno.test("lastNCompleteMonthKeys: never includes the current (incomplete) month", () => {
  const keys = lastNCompleteMonthKeys("2026-08", 3);
  assertEquals(keys.includes("2026-08"), false);
});

Deno.test("lastNCompleteMonthKeys: rejects a negative count", () => {
  assertThrows(() => lastNCompleteMonthKeys("2026-08", -1), RangeError);
});

// ---------------------------------------------------------------------------
// computeVariableIncomeRecommendation
// ---------------------------------------------------------------------------

Deno.test("computeVariableIncomeRecommendation: no historical data falls back to the expected amount alone", () => {
  const result = computeVariableIncomeRecommendation([], 500_000n);
  assertEquals(result.averageMinor, null);
  assertEquals(result.recommendedMinor, 500_000n);
  assertEquals(result.monthsUsed, 0);
});

Deno.test("computeVariableIncomeRecommendation: no historical data and no expected amount yields no recommendation at all", () => {
  const result = computeVariableIncomeRecommendation([], null);
  assertEquals(result.averageMinor, null);
  assertEquals(result.recommendedMinor, null);
  assertEquals(result.monthsUsed, 0);
});

Deno.test("computeVariableIncomeRecommendation: averages 3 complete months", () => {
  const result = computeVariableIncomeRecommendation(
    [400_000n, 500_000n, 600_000n],
    null,
  );
  assertEquals(result.averageMinor, 500_000n);
  assertEquals(result.monthsUsed, 3);
});

Deno.test("computeVariableIncomeRecommendation: uses however many complete months exist when fewer than 3 (insufficient history, handled explicitly)", () => {
  const result = computeVariableIncomeRecommendation([450_000n], null);
  assertEquals(result.averageMinor, 450_000n);
  assertEquals(result.monthsUsed, 1);
});

Deno.test("computeVariableIncomeRecommendation: recommends the LOWER of expected income and the historical average", () => {
  const lowerExpected = computeVariableIncomeRecommendation([600_000n, 600_000n], 500_000n);
  assertEquals(lowerExpected.averageMinor, 600_000n);
  assertEquals(lowerExpected.recommendedMinor, 500_000n); // expected is lower

  const lowerAverage = computeVariableIncomeRecommendation([400_000n, 400_000n], 500_000n);
  assertEquals(lowerAverage.averageMinor, 400_000n);
  assertEquals(lowerAverage.recommendedMinor, 400_000n); // average is lower
});

Deno.test("computeVariableIncomeRecommendation: equal expected and average recommends that same value", () => {
  const result = computeVariableIncomeRecommendation([500_000n, 500_000n], 500_000n);
  assertEquals(result.recommendedMinor, 500_000n);
});

Deno.test("computeVariableIncomeRecommendation: average rounds half-up when not evenly divisible", () => {
  const result = computeVariableIncomeRecommendation([100_000n, 100_001n], null); // sum 200,001 / 2 = 100,000.5
  assertEquals(result.averageMinor, 100_001n); // half-up
});
