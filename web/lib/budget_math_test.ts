import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  allocateAmounts,
  AllocationPercentages,
  isExactly100Percent,
  normalizeIncome,
  STANDARD_ALLOCATION_PERCENTAGES,
  validatePercentages,
} from "./budget-math.ts";

// ---------------------------------------------------------------------------
// normalizeIncome
// ---------------------------------------------------------------------------

Deno.test("normalizeIncome: weekly -> annual = amount * 52, monthly = annual / 12", () => {
  const result = normalizeIncome(100_000n, "weekly");
  assertEquals(result.annualMinor, 5_200_000n);
  assertEquals(result.monthlyMinor, 433_333n); // 5,200,000 / 12 = 433,333.33 -> 433,333
});

Deno.test("normalizeIncome: biweekly -> annual = amount * 26, monthly = annual / 12", () => {
  const result = normalizeIncome(200_000n, "biweekly");
  assertEquals(result.annualMinor, 5_200_000n);
  assertEquals(result.monthlyMinor, 433_333n);
});

Deno.test("normalizeIncome: semimonthly -> annual = amount * 24, monthly = annual / 12", () => {
  const result = normalizeIncome(250_000n, "semimonthly");
  assertEquals(result.annualMinor, 6_000_000n);
  assertEquals(result.monthlyMinor, 500_000n);
});

Deno.test("normalizeIncome: monthly -> annual = amount * 12, monthly = amount", () => {
  const result = normalizeIncome(500_000n, "monthly");
  assertEquals(result.monthlyMinor, 500_000n);
  assertEquals(result.annualMinor, 6_000_000n);
});

Deno.test("normalizeIncome: annual -> monthly = amount / 12, annual = amount", () => {
  const result = normalizeIncome(6_000_000n, "annual");
  assertEquals(result.annualMinor, 6_000_000n);
  assertEquals(result.monthlyMinor, 500_000n);
});

Deno.test("normalizeIncome: annual not evenly divisible by 12 rounds half-up", () => {
  const result = normalizeIncome(100n, "annual"); // 8.33... -> 8
  assertEquals(result.monthlyMinor, 8n);
});

Deno.test("normalizeIncome: zero income normalizes to zero everywhere", () => {
  for (
    const freq of ["weekly", "biweekly", "semimonthly", "monthly", "annual"] as const
  ) {
    const result = normalizeIncome(0n, freq);
    assertEquals(result.monthlyMinor, 0n);
    assertEquals(result.annualMinor, 0n);
  }
});

Deno.test("normalizeIncome: rejects negative income", () => {
  assertThrows(() => normalizeIncome(-1n, "monthly"), RangeError);
});

Deno.test("normalizeIncome: large EUR-cents income does not overflow (bigint arithmetic)", () => {
  const result = normalizeIncome(1_000_000_00n, "annual"); // 1,000,000.00 EUR
  assertEquals(result.annualMinor, 1_000_000_00n);
  assertEquals(result.monthlyMinor, 8_333_333n); // /12 rounded
});

// ---------------------------------------------------------------------------
// validatePercentages / isExactly100Percent
// ---------------------------------------------------------------------------

Deno.test("validatePercentages: the standard 50/15/5/30 split is valid and totals 100", () => {
  const result = validatePercentages(STANDARD_ALLOCATION_PERCENTAGES);
  assertEquals(result.valid, true);
  if (result.valid) assertEquals(result.totalPercent, 100);
});

Deno.test("validatePercentages: a draft totaling less than 100 is still valid (in progress)", () => {
  const draft: AllocationPercentages = {
    ESSENTIALS: 40,
    INVESTING: 10,
    EMERGENCY: 5,
    WANTS: 20,
  };
  const result = validatePercentages(draft);
  assertEquals(result.valid, true);
  if (result.valid) assertEquals(result.totalPercent, 75);
});

Deno.test("validatePercentages: rejects a total exceeding 100%", () => {
  const overAllocated: AllocationPercentages = {
    ESSENTIALS: 60,
    INVESTING: 20,
    EMERGENCY: 10,
    WANTS: 20,
  };
  const result = validatePercentages(overAllocated);
  assertEquals(result.valid, false);
});

Deno.test("validatePercentages: rejects a negative percentage", () => {
  const negative: AllocationPercentages = {
    ESSENTIALS: -10,
    INVESTING: 15,
    EMERGENCY: 5,
    WANTS: 30,
  };
  const result = validatePercentages(negative);
  assertEquals(result.valid, false);
});

Deno.test("validatePercentages: rejects a single allocation exceeding 100%", () => {
  const invalid: AllocationPercentages = {
    ESSENTIALS: 150,
    INVESTING: 0,
    EMERGENCY: 0,
    WANTS: 0,
  };
  const result = validatePercentages(invalid);
  assertEquals(result.valid, false);
});

Deno.test("isExactly100Percent: true for the standard split", () => {
  assertEquals(isExactly100Percent(STANDARD_ALLOCATION_PERCENTAGES), true);
});

Deno.test("isExactly100Percent: false for 99%", () => {
  const almost: AllocationPercentages = {
    ESSENTIALS: 49,
    INVESTING: 15,
    EMERGENCY: 5,
    WANTS: 30,
  };
  assertEquals(isExactly100Percent(almost), false);
});

Deno.test("isExactly100Percent: tolerates 0.01 floating rounding", () => {
  const tiny: AllocationPercentages = {
    ESSENTIALS: 50.005,
    INVESTING: 15,
    EMERGENCY: 5,
    WANTS: 29.995,
  };
  assertEquals(isExactly100Percent(tiny), true);
});

// ---------------------------------------------------------------------------
// allocateAmounts (rounding remainder assignment)
// ---------------------------------------------------------------------------

Deno.test("allocateAmounts: standard split of an evenly-divisible RWF income sums exactly", () => {
  const result = allocateAmounts(1_000_000n, STANDARD_ALLOCATION_PERCENTAGES);
  assertEquals(result.ESSENTIALS, 500_000n);
  assertEquals(result.INVESTING, 150_000n);
  assertEquals(result.EMERGENCY, 50_000n);
  assertEquals(result.WANTS, 300_000n);
  const sum = result.ESSENTIALS + result.INVESTING + result.EMERGENCY +
    result.WANTS;
  assertEquals(sum, 1_000_000n);
});

Deno.test("allocateAmounts: an income not evenly divisible by the percentages still sums exactly (remainder assignment)", () => {
  // 100,001 split 50/15/5/30 doesn't divide evenly into any bucket.
  const result = allocateAmounts(100_001n, STANDARD_ALLOCATION_PERCENTAGES);
  const sum = result.ESSENTIALS + result.INVESTING + result.EMERGENCY +
    result.WANTS;
  assertEquals(sum, 100_001n);
});

Deno.test("allocateAmounts: a single RWF unit (indivisible) is assigned deterministically to ESSENTIALS (largest remainder, first in tie-break order)", () => {
  const result = allocateAmounts(1n, STANDARD_ALLOCATION_PERCENTAGES);
  assertEquals(result.ESSENTIALS, 1n);
  assertEquals(result.INVESTING, 0n);
  assertEquals(result.EMERGENCY, 0n);
  assertEquals(result.WANTS, 0n);
});

Deno.test("allocateAmounts: repeated calls with the same input are byte-identical (deterministic)", () => {
  const a = allocateAmounts(7_777_777n, STANDARD_ALLOCATION_PERCENTAGES);
  const b = allocateAmounts(7_777_777n, STANDARD_ALLOCATION_PERCENTAGES);
  assertEquals(a, b);
});

Deno.test("allocateAmounts: zero income allocates zero to every bucket", () => {
  const result = allocateAmounts(0n, STANDARD_ALLOCATION_PERCENTAGES);
  assertEquals(result.ESSENTIALS, 0n);
  assertEquals(result.INVESTING, 0n);
  assertEquals(result.EMERGENCY, 0n);
  assertEquals(result.WANTS, 0n);
});

Deno.test("allocateAmounts: an in-progress draft (percentages below 100%) never tops up beyond its own proportional share", () => {
  const draft: AllocationPercentages = {
    ESSENTIALS: 40,
    INVESTING: 10,
    EMERGENCY: 5,
    WANTS: 20,
  }; // totals 75%
  const result = allocateAmounts(1_000_000n, draft);
  const sum = result.ESSENTIALS + result.INVESTING + result.EMERGENCY +
    result.WANTS;
  // Must be approximately 75% of the total, NOT topped up toward
  // 1,000,000 - this is the bug this test guards against: the remainder
  // loop must never redistribute the genuinely-unallocated 25%.
  assertEquals(sum, 750_000n);
});

Deno.test("allocateAmounts: 100% concentrated in one allocation puts the whole total there, others zero", () => {
  const allIn: AllocationPercentages = {
    ESSENTIALS: 100,
    INVESTING: 0,
    EMERGENCY: 0,
    WANTS: 0,
  };
  const result = allocateAmounts(333_333n, allIn);
  assertEquals(result.ESSENTIALS, 333_333n);
  assertEquals(result.INVESTING, 0n);
  assertEquals(result.EMERGENCY, 0n);
  assertEquals(result.WANTS, 0n);
});

Deno.test("allocateAmounts: rejects negative total", () => {
  assertThrows(
    () => allocateAmounts(-1n, STANDARD_ALLOCATION_PERCENTAGES),
    RangeError,
  );
});

Deno.test("allocateAmounts: large EUR-cents income sums exactly with fractional percentages", () => {
  const custom: AllocationPercentages = {
    ESSENTIALS: 45.5,
    INVESTING: 20.25,
    EMERGENCY: 4.25,
    WANTS: 30,
  };
  const result = allocateAmounts(123_456_789n, custom);
  const sum = result.ESSENTIALS + result.INVESTING + result.EMERGENCY +
    result.WANTS;
  assertEquals(sum, 123_456_789n);
});
