// Pure 50/15/5/30 budget calculator math: income normalization and
// allocation-amount distribution. Zero imports (only used by other
// dependency-free modules) so it can be unit-tested with `deno test`
// (see budget_math_test.ts), matching this repository's established
// pattern for pure financial logic (supabase/functions/ingest-momo/tests/).
//
// Every amount in and out of this module is integer minor units (bigint)
// of one specific currency - see money.ts. This module never rounds a
// floating-point amount itself; toMinorUnits() at the UI boundary is the
// only place a user-typed decimal is ever rounded.

import { divRoundBigInt } from "./money.ts";

export type IncomeFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "annual";

export const INCOME_FREQUENCIES: readonly IncomeFrequency[] = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "annual",
];

/** Whether this frequency represents a discrete paycheck (as opposed to a monthly/annual total). */
export function isPerPaycheckFrequency(frequency: IncomeFrequency): boolean {
  return frequency === "weekly" || frequency === "biweekly" ||
    frequency === "semimonthly";
}

const PAYCHECKS_PER_YEAR: Partial<Record<IncomeFrequency, number>> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
};

export type NormalizedIncome = {
  monthlyMinor: bigint;
  annualMinor: bigint;
};

/**
 * Normalizes an income figure (expressed at the given frequency) into
 * canonical monthly and annual amounts.
 *
 *   weekly:       annual = amount * 52,  monthly = annual / 12
 *   biweekly:     annual = amount * 26,  monthly = annual / 12
 *   semimonthly:  annual = amount * 24,  monthly = annual / 12
 *   monthly:      annual = amount * 12,  monthly = amount
 *   annual:       monthly = amount / 12, annual = amount
 *
 * monthly = annual / 12 for every paycheck frequency (not amount * 12/n
 * directly) so that annualMinor is always the mathematically primary
 * figure paychecks compound into, and monthly is a deterministic rounding
 * of it - matching "annual from weekly = paycheck * 52; monthly from
 * weekly = annual / 12" in the product spec exactly.
 */
export function normalizeIncome(
  amountMinor: bigint,
  frequency: IncomeFrequency,
): NormalizedIncome {
  if (amountMinor < 0n) {
    throw new RangeError("amountMinor must not be negative");
  }

  switch (frequency) {
    case "weekly":
    case "biweekly":
    case "semimonthly": {
      const paychecksPerYear = BigInt(PAYCHECKS_PER_YEAR[frequency]!);
      const annualMinor = amountMinor * paychecksPerYear;
      return { annualMinor, monthlyMinor: divRoundBigInt(annualMinor, 12n) };
    }
    case "monthly":
      return { monthlyMinor: amountMinor, annualMinor: amountMinor * 12n };
    case "annual":
      return {
        monthlyMinor: divRoundBigInt(amountMinor, 12n),
        annualMinor: amountMinor,
      };
  }
}

export const ALLOCATION_TYPES = [
  "ESSENTIALS",
  "INVESTING",
  "EMERGENCY",
  "WANTS",
] as const;
export type AllocationType = (typeof ALLOCATION_TYPES)[number];

export const STANDARD_ALLOCATION_PERCENTAGES: Record<AllocationType, number> = {
  ESSENTIALS: 50,
  INVESTING: 15,
  EMERGENCY: 5,
  WANTS: 30,
};

export type AllocationPercentages = Record<AllocationType, number>;

export type PercentageValidation =
  | { valid: true; totalPercent: number }
  | { valid: false; totalPercent: number; error: string };

/**
 * Validates a set of allocation percentages for saving as a draft
 * (negative/out-of-range/>100%% total are always rejected; a total below
 * 100%% is allowed for a draft - see validateForActivation for the
 * stricter exactly-100%% rule required before activation).
 */
export function validatePercentages(
  percentages: AllocationPercentages,
): PercentageValidation {
  for (const type of ALLOCATION_TYPES) {
    const value = percentages[type];
    if (!Number.isFinite(value) || value < 0) {
      return {
        valid: false,
        totalPercent: 0,
        error: `${type} percentage must be zero or greater.`,
      };
    }
    if (value > 100) {
      return {
        valid: false,
        totalPercent: 0,
        error: `${type} percentage cannot exceed 100%.`,
      };
    }
  }

  const totalPercent = ALLOCATION_TYPES.reduce(
    (sum, type) => sum + percentages[type],
    0,
  );

  if (totalPercent > 100.0001) {
    return {
      valid: false,
      totalPercent,
      error: `Allocation percentages total ${
        totalPercent.toFixed(2)
      }%, which exceeds 100%.`,
    };
  }

  return { valid: true, totalPercent };
}

/** The stricter rule required before a budget may activate: total must be exactly 100% (0.01 tolerance for display rounding). */
export function isExactly100Percent(percentages: AllocationPercentages): boolean {
  const total = ALLOCATION_TYPES.reduce(
    (sum, type) => sum + percentages[type],
    0,
  );
  return Math.abs(total - 100) <= 0.01;
}

/**
 * Distributes `totalMinor` across the four allocation types by
 * percentage, using the largest-remainder method (Hamilton's method) so
 * the four resulting amounts always sum to EXACTLY totalMinor - never
 * off by a minor unit from naive independent rounding. Percentages are
 * converted to integer basis points (percentage * 100) first so the
 * whole computation stays in exact bigint arithmetic with no
 * floating-point intermediate.
 *
 * Any leftover minor units (there are at most 3, one per "loser" of the
 * four-way split) are assigned to the allocations with the largest
 * fractional remainder first; ties are broken by fixed allocation order
 * (ESSENTIALS, INVESTING, EMERGENCY, WANTS) so the result is fully
 * deterministic and reproducible - this IS the "deterministic rounding
 * remainder assignment" rule required by the product spec.
 */
export function allocateAmounts(
  totalMinor: bigint,
  percentages: AllocationPercentages,
): Record<AllocationType, bigint> {
  if (totalMinor < 0n) {
    throw new RangeError("totalMinor must not be negative");
  }

  const basisPoints = (type: AllocationType) =>
    BigInt(Math.round(percentages[type] * 100));

  const floorAmounts = new Map<AllocationType, bigint>();
  const remainders = new Map<AllocationType, bigint>();

  for (const type of ALLOCATION_TYPES) {
    const bps = basisPoints(type);
    const product = totalMinor * bps;
    floorAmounts.set(type, product / 10000n);
    remainders.set(type, product % 10000n);
  }

  const result: Record<AllocationType, bigint> = {
    ESSENTIALS: floorAmounts.get("ESSENTIALS")!,
    INVESTING: floorAmounts.get("INVESTING")!,
    EMERGENCY: floorAmounts.get("EMERGENCY")!,
    WANTS: floorAmounts.get("WANTS")!,
  };

  // Only top up to close the sum-to-totalMinor gap when the percentages
  // themselves total exactly 100% - the gap between floor-sum and
  // totalMinor is then purely rounding error (at most 3 minor units,
  // bounded by the 4-way split) and safe to redistribute. When
  // percentages total less than 100% (an in-progress draft), that same
  // gap is the genuinely UNALLOCATED remainder, not rounding error, and
  // must be left out of every bucket rather than silently topped up.
  const totalBasisPoints = ALLOCATION_TYPES.reduce(
    (sum, type) => sum + basisPoints(type),
    0n,
  );
  if (totalBasisPoints !== 10000n) {
    return result;
  }

  let leftover = totalMinor -
    Array.from(floorAmounts.values()).reduce((sum, v) => sum + v, 0n);

  const byRemainderDesc = [...ALLOCATION_TYPES].sort((a, b) => {
    const diff = remainders.get(b)! - remainders.get(a)!;
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return ALLOCATION_TYPES.indexOf(a) - ALLOCATION_TYPES.indexOf(b);
  });

  for (const type of byRemainderDesc) {
    if (leftover <= 0n) break;
    result[type] += 1n;
    leftover -= 1n;
  }

  return result;
}
