import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  allocationStatus,
  computeAllocationActual,
  computeElapsedFraction,
  daysBetweenDateKeys,
} from "./budget-math.ts";

// ---------------------------------------------------------------------------
// allocationStatus (75/90/100% thresholds)
// ---------------------------------------------------------------------------

Deno.test("allocationStatus: below 75% is healthy", () => {
  assertEquals(allocationStatus(740_000n, 1_000_000n), "healthy");
});

Deno.test("allocationStatus: exactly 75% is watch (threshold is inclusive)", () => {
  assertEquals(allocationStatus(750_000n, 1_000_000n), "watch");
});

Deno.test("allocationStatus: between 75% and 90% is watch", () => {
  assertEquals(allocationStatus(800_000n, 1_000_000n), "watch");
});

Deno.test("allocationStatus: exactly 90% is at_risk (threshold is inclusive)", () => {
  assertEquals(allocationStatus(900_000n, 1_000_000n), "at_risk");
});

Deno.test("allocationStatus: between 90% and 100% is at_risk", () => {
  assertEquals(allocationStatus(950_000n, 1_000_000n), "at_risk");
});

Deno.test("allocationStatus: exactly 100% is exceeded (threshold is inclusive)", () => {
  assertEquals(allocationStatus(1_000_000n, 1_000_000n), "exceeded");
});

Deno.test("allocationStatus: over 100% is exceeded", () => {
  assertEquals(allocationStatus(1_500_000n, 1_000_000n), "exceeded");
});

Deno.test("allocationStatus: zero target with zero spending is insufficient_data, not healthy", () => {
  assertEquals(allocationStatus(0n, 0n), "insufficient_data");
});

Deno.test("allocationStatus: zero target with any spending is exceeded", () => {
  assertEquals(allocationStatus(1n, 0n), "exceeded");
});

Deno.test("allocationStatus: zero spending against a positive target is healthy", () => {
  assertEquals(allocationStatus(0n, 1_000_000n), "healthy");
});

// ---------------------------------------------------------------------------
// daysBetweenDateKeys
// ---------------------------------------------------------------------------

Deno.test("daysBetweenDateKeys: same date is zero", () => {
  assertEquals(daysBetweenDateKeys("2026-08-01", "2026-08-01"), 0);
});

Deno.test("daysBetweenDateKeys: within a calendar month", () => {
  assertEquals(daysBetweenDateKeys("2026-08-01", "2026-08-31"), 30);
});

Deno.test("daysBetweenDateKeys: across a month boundary", () => {
  assertEquals(daysBetweenDateKeys("2026-08-15", "2026-09-15"), 31);
});

Deno.test("daysBetweenDateKeys: across a year boundary", () => {
  assertEquals(daysBetweenDateKeys("2026-12-25", "2027-01-05"), 11);
});

Deno.test("daysBetweenDateKeys: negative when to is before from", () => {
  assertEquals(daysBetweenDateKeys("2026-08-15", "2026-08-01"), -14);
});

Deno.test("daysBetweenDateKeys: rejects a malformed date key", () => {
  assertThrows(() => daysBetweenDateKeys("2026/08/01", "2026-08-02"), RangeError);
  assertThrows(() => daysBetweenDateKeys("2026-08-01", "not-a-date"), RangeError);
});

// ---------------------------------------------------------------------------
// computeElapsedFraction
// ---------------------------------------------------------------------------

Deno.test("computeElapsedFraction: null when the budget is not active", () => {
  assertEquals(
    computeElapsedFraction("2026-08-01", "2026-08-31", "2026-08-15", false),
    null,
  );
});

Deno.test("computeElapsedFraction: null when today is before the period starts", () => {
  assertEquals(
    computeElapsedFraction("2026-08-01", "2026-08-31", "2026-07-31", true),
    null,
  );
});

Deno.test("computeElapsedFraction: null when today is after the period ends", () => {
  assertEquals(
    computeElapsedFraction("2026-08-01", "2026-08-31", "2026-09-01", true),
    null,
  );
});

Deno.test("computeElapsedFraction: first day of the period is 1/totalDays, never zero", () => {
  const fraction = computeElapsedFraction("2026-08-01", "2026-08-31", "2026-08-01", true);
  assertEquals(fraction, 1 / 31);
});

Deno.test("computeElapsedFraction: last day of the period is exactly 1", () => {
  const fraction = computeElapsedFraction("2026-08-01", "2026-08-31", "2026-08-31", true);
  assertEquals(fraction, 1);
});

Deno.test("computeElapsedFraction: midpoint of a 31-day month", () => {
  const fraction = computeElapsedFraction("2026-08-01", "2026-08-31", "2026-08-16", true);
  assertEquals(fraction, 16 / 31);
});

// ---------------------------------------------------------------------------
// computeAllocationActual
// ---------------------------------------------------------------------------

Deno.test("computeAllocationActual: under target, no elapsed fraction (no projection)", () => {
  const result = computeAllocationActual(300_000n, 500_000n, null);
  assertEquals(result.remainingMinor, 200_000n);
  assertEquals(result.percentConsumed, 60);
  assertEquals(result.projectedMinor, null);
  assertEquals(result.status, "healthy");
});

Deno.test("computeAllocationActual: over target, remainingMinor goes negative", () => {
  const result = computeAllocationActual(600_000n, 500_000n, null);
  assertEquals(result.remainingMinor, -100_000n);
  assertEquals(result.status, "exceeded");
});

Deno.test("computeAllocationActual: projects month-end spending from elapsedFraction", () => {
  // Halfway through the month, spent 250,000 of a 500,000 target ->
  // projected to spend 500,000 by month end (exactly on pace).
  const result = computeAllocationActual(250_000n, 500_000n, 0.5);
  assertEquals(result.projectedMinor, 500_000n);
});

Deno.test("computeAllocationActual: elapsedFraction of exactly 0 yields no projection (would divide by zero)", () => {
  const result = computeAllocationActual(0n, 500_000n, 0);
  assertEquals(result.projectedMinor, null);
});

Deno.test("computeAllocationActual: zero target with zero actual is insufficient_data with a defined (zero) percent", () => {
  const result = computeAllocationActual(0n, 0n, null);
  assertEquals(result.status, "insufficient_data");
  assertEquals(result.percentConsumed, 0);
});
