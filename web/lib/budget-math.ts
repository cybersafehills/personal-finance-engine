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
 * (negative/out-of-range/>100% total are always rejected; a total below
 * 100% is allowed for a draft - see validateForActivation for the
 * stricter exactly-100% rule required before activation).
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
export function isExactly100Percent(
  percentages: AllocationPercentages,
): boolean {
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

// ---------------------------------------------------------------------------
// Budget-vs-actual: allocation status thresholds and period-elapsed math.
// Pure and dependency-free (queries.ts, which does the actual database
// aggregation, is `server-only` and can't be unit-tested with `deno test`
// directly - this is deliberately factored out so the thresholds and date
// arithmetic themselves are testable independent of any database call).
// ---------------------------------------------------------------------------

export type AllocationStatus =
  | "healthy"
  | "watch"
  | "at_risk"
  | "exceeded"
  | "insufficient_data";

const WATCH_THRESHOLD_PERCENT = 75;
const AT_RISK_THRESHOLD_PERCENT = 90;
const EXCEEDED_THRESHOLD_PERCENT = 100;

/**
 * Status thresholds default to 75/90/100%, matching the product spec's
 * own defaults. `targetMinor <= 0` is treated as insufficient_data unless
 * there is already spending against it (exceeded) - a percentage against
 * a zero target is meaningless, not "0% healthy".
 */
export function allocationStatus(
  actualMinor: bigint,
  targetMinor: bigint,
): AllocationStatus {
  if (targetMinor <= 0n) {
    return actualMinor > 0n ? "exceeded" : "insufficient_data";
  }
  const percent = Number((actualMinor * 10000n) / targetMinor) / 100;
  if (percent >= EXCEEDED_THRESHOLD_PERCENT) return "exceeded";
  if (percent >= AT_RISK_THRESHOLD_PERCENT) return "at_risk";
  if (percent >= WATCH_THRESHOLD_PERCENT) return "watch";
  return "healthy";
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whole-day difference between two "YYYY-MM-DD" calendar date keys (toDateKey - fromDateKey), independent of any timezone offset. */
export function daysBetweenDateKeys(
  fromDateKey: string,
  toDateKey: string,
): number {
  if (
    !DATE_KEY_PATTERN.test(fromDateKey) || !DATE_KEY_PATTERN.test(toDateKey)
  ) {
    throw new RangeError(
      `daysBetweenDateKeys expects "YYYY-MM-DD" date keys, got ${fromDateKey} / ${toDateKey}`,
    );
  }
  const [fy, fm, fd] = fromDateKey.split("-").map(Number);
  const [ty, tm, td] = toDateKey.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

/**
 * Fraction (0-1] of a budget period elapsed as of `todayDateKey`, or null
 * when a projection wouldn't be meaningful: the budget isn't active, or
 * today falls outside the period entirely (a budget created mid-period
 * for a past or future month, or not yet started). Both boundary days
 * (period_start and the current day) count as fully elapsed - a budget
 * on its first day has elapsedFraction = 1/totalDays, never 0, so a
 * same-day projection is still computable rather than dividing by zero.
 */
export function computeElapsedFraction(
  periodStart: string,
  periodEnd: string,
  todayDateKey: string,
  isActive: boolean,
): number | null {
  if (!isActive) return null;
  if (todayDateKey < periodStart || todayDateKey > periodEnd) return null;

  const totalDays = daysBetweenDateKeys(periodStart, periodEnd) + 1;
  const elapsedDays = daysBetweenDateKeys(periodStart, todayDateKey) + 1;
  return Math.min(1, elapsedDays / totalDays);
}

export type AllocationActualMath = {
  actualMinor: bigint;
  targetMinor: bigint;
  remainingMinor: bigint;
  /** null only when targetMinor is 0 and there is spending against it - a percentage is meaningless there. */
  percentConsumed: number | null;
  /** null unless elapsedFraction is provided and greater than 0. */
  projectedMinor: bigint | null;
  status: AllocationStatus;
};

/** Combines actual/target into the full set of derived figures a dashboard card needs, given an already-computed elapsedFraction (see computeElapsedFraction). */
export function computeAllocationActual(
  actualMinor: bigint,
  targetMinor: bigint,
  elapsedFraction: number | null,
): AllocationActualMath {
  const percentConsumed = targetMinor > 0n
    ? Number((actualMinor * 10000n) / targetMinor) / 100
    : actualMinor > 0n
    ? null
    : 0;

  const projectedMinor = elapsedFraction !== null && elapsedFraction > 0
    ? BigInt(Math.round(Number(actualMinor) / elapsedFraction))
    : null;

  return {
    actualMinor,
    targetMinor,
    remainingMinor: targetMinor - actualMinor,
    percentConsumed,
    projectedMinor,
    status: allocationStatus(actualMinor, targetMinor),
  };
}

// ---------------------------------------------------------------------------
// Alerts: computed fresh on every read from already-computed actuals, not
// a persisted/deduplicated budget_alerts table with its own resolution
// workflow (see the D1 scope note - that needs background-job infra this
// project doesn't have yet). Recomputing on read means an alert can never
// go stale and never needs an explicit "resolved" step: it simply stops
// appearing once the condition that produced it is no longer true.
// Deduplication instead comes from `id` being deterministic per
// condition (e.g. one allocation can only ever produce one status alert
// at a time) - a caller rendering by `id` never sees the same thing twice.
// ---------------------------------------------------------------------------

export type AlertSeverity = "info" | "warning" | "critical";

export type BudgetAlert =
  | {
    id: string;
    kind: "allocation_watch" | "allocation_at_risk";
    severity: "info" | "warning";
    allocationType: AllocationType;
    percentConsumed: number;
  }
  | {
    id: string;
    kind: "allocation_exceeded";
    severity: "critical";
    allocationType: AllocationType;
    actualMinor: bigint;
    targetMinor: bigint;
  }
  | {
    id: string;
    kind: "unmapped_spending" | "uncategorized_spending";
    severity: "warning";
    count: number;
    totalMinor: bigint;
  }
  | {
    id: string;
    kind: "income_below_budget";
    severity: "warning";
    budgetedMinor: bigint;
    actualMinor: bigint;
    shortfallPercent: number;
  };

/** Income is flagged only once at least half the period has elapsed, so a slow-to-post paycheck on day 3 doesn't read as a shortfall. */
const INCOME_CHECK_MIN_ELAPSED_FRACTION = 0.5;
const INCOME_SHORTFALL_THRESHOLD_PERCENT = 10;

export type BudgetAlertInput = {
  allocations: {
    allocationType: AllocationType;
    actualMinor: bigint;
    targetMinor: bigint;
    status: AllocationStatus;
  }[];
  unmappedCount: number;
  unmappedMinor: bigint;
  uncategorizedCount: number;
  uncategorizedMinor: bigint;
  budgetedIncomeMinor: bigint;
  actualIncomeMinor: bigint;
  elapsedFraction: number | null;
};

/**
 * Derives the current set of alerts from a budget's already-computed
 * actuals. Pure and deterministic: the same input always produces the
 * same alerts, in the same order, with the same `id`s - see the module
 * comment above for why that's what stands in for persistence here.
 */
export function computeBudgetAlerts(input: BudgetAlertInput): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];

  for (const allocation of input.allocations) {
    if (allocation.status === "watch") {
      alerts.push({
        id: `allocation-watch-${allocation.allocationType}`,
        kind: "allocation_watch",
        severity: "info",
        allocationType: allocation.allocationType,
        percentConsumed: Number(
          (allocation.actualMinor * 10000n) / allocation.targetMinor,
        ) / 100,
      });
    } else if (allocation.status === "at_risk") {
      alerts.push({
        id: `allocation-at-risk-${allocation.allocationType}`,
        kind: "allocation_at_risk",
        severity: "warning",
        allocationType: allocation.allocationType,
        percentConsumed: Number(
          (allocation.actualMinor * 10000n) / allocation.targetMinor,
        ) / 100,
      });
    } else if (allocation.status === "exceeded") {
      alerts.push({
        id: `allocation-exceeded-${allocation.allocationType}`,
        kind: "allocation_exceeded",
        severity: "critical",
        allocationType: allocation.allocationType,
        actualMinor: allocation.actualMinor,
        targetMinor: allocation.targetMinor,
      });
    }
  }

  if (input.unmappedCount > 0) {
    alerts.push({
      id: "unmapped-spending",
      kind: "unmapped_spending",
      severity: "warning",
      count: input.unmappedCount,
      totalMinor: input.unmappedMinor,
    });
  }

  if (input.uncategorizedCount > 0) {
    alerts.push({
      id: "uncategorized-spending",
      kind: "uncategorized_spending",
      severity: "warning",
      count: input.uncategorizedCount,
      totalMinor: input.uncategorizedMinor,
    });
  }

  if (
    input.elapsedFraction !== null &&
    input.elapsedFraction >= INCOME_CHECK_MIN_ELAPSED_FRACTION &&
    input.budgetedIncomeMinor > 0n
  ) {
    const shortfallPercent = 100 -
      Number((input.actualIncomeMinor * 10000n) / input.budgetedIncomeMinor) /
        100;
    if (shortfallPercent >= INCOME_SHORTFALL_THRESHOLD_PERCENT) {
      alerts.push({
        id: "income-below-budget",
        kind: "income_below_budget",
        severity: "warning",
        budgetedMinor: input.budgetedIncomeMinor,
        actualMinor: input.actualIncomeMinor,
        shortfallPercent,
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Variable income: "lower of expected monthly income and the average
// qualifying income over the previous 3 complete months" (product spec
// section 6). Pure - the actual database query for which transactions
// qualify lives in web/lib/queries.ts; this only does the month-key
// arithmetic and the averaging/minimum itself.
// ---------------------------------------------------------------------------

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

function parseMonthKey(monthKey: string): { year: number; month: number } {
  if (!MONTH_KEY_PATTERN.test(monthKey)) {
    throw new RangeError(`Expected a "YYYY-MM" month key, got ${monthKey}`);
  }
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

/** Shifts a "YYYY-MM" month key by `deltaMonths` (negative to go back in time). */
export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const zeroBasedTotal = (year * 12 + (month - 1)) + deltaMonths;
  const newYear = Math.floor(zeroBasedTotal / 12);
  const newMonth = (zeroBasedTotal % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

/**
 * The `count` calendar months immediately BEFORE `todayMonthKey` (never
 * including the current, still-in-progress month) - "complete months"
 * per the product spec, oldest first.
 */
export function lastNCompleteMonthKeys(
  todayMonthKey: string,
  count: number,
): string[] {
  if (count < 0) throw new RangeError("count must not be negative");
  const keys: string[] = [];
  for (let i = count; i >= 1; i--) {
    keys.push(shiftMonthKey(todayMonthKey, -i));
  }
  return keys;
}

export type VariableIncomeRecommendation = {
  averageMinor: bigint | null;
  recommendedMinor: bigint | null;
  monthsUsed: number;
};

// ---------------------------------------------------------------------------
// Outflow-to-allocation aggregation: which allocation bucket each settled
// outgoing transaction's effect counts against. Extracted out of
// web/lib/queries.ts's getBudgetActuals (which still owns fetching the
// rows) so this classification logic has exactly one implementation -
// the Scheduled Financial Reporting engine's budget section
// (web/lib/report-generation.ts) needs the identical aggregation for a
// service-role, explicitly workspace-scoped query and must not
// reimplement it (master prompt §64: no parallel financial logic). Pure
// and dependency-free, like the rest of this module.
// ---------------------------------------------------------------------------

export type MappedOutflow = {
  transactionId: string;
  category: string | null;
  /** Absolute value of principal_effect + fee_effect for this transaction, already excluding confirmed self-transfers. */
  effectMinor: bigint;
  /** "YYYY-MM-DD" - the mapping lookup is effective-dated per transaction, not per budget period (see budget_category_mappings' own migration comment). */
  occurredAtDateKey: string;
};

export type SplitAllocation = {
  transactionId: string;
  allocationType: AllocationType;
  amountMinor: bigint;
};

export type CategoryMappingWindow = {
  category: string;
  allocationType: AllocationType;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type AllocationActualsAggregation = {
  totalsByAllocation: Record<AllocationType, bigint>;
  unmappedMinor: bigint;
  unmappedCount: number;
  uncategorizedMinor: bigint;
  uncategorizedCount: number;
};

/**
 * Classifies each outflow into an allocation bucket: a transaction with
 * its own split rows is governed entirely by those splits regardless of
 * its category (a split transaction's category, if any, is ignored here -
 * matching the pre-extraction behavior); otherwise a null/empty category
 * counts as uncategorized, a category with no currently-effective mapping
 * counts as unmapped, and everything else counts against its mapped
 * allocation. `outflows` must already exclude confirmed self-transfers -
 * this function has no transfer-link data to filter with.
 */
export function aggregateOutflowsByAllocation(
  outflows: MappedOutflow[],
  splits: SplitAllocation[],
  mappings: CategoryMappingWindow[],
): AllocationActualsAggregation {
  const splitsByTransaction = new Map<string, SplitAllocation[]>();
  for (const split of splits) {
    const existing = splitsByTransaction.get(split.transactionId) ?? [];
    existing.push(split);
    splitsByTransaction.set(split.transactionId, existing);
  }

  const totalsByAllocation: Record<AllocationType, bigint> = {
    ESSENTIALS: 0n,
    INVESTING: 0n,
    EMERGENCY: 0n,
    WANTS: 0n,
  };
  let unmappedMinor = 0n;
  let unmappedCount = 0;
  let uncategorizedMinor = 0n;
  let uncategorizedCount = 0;

  for (const row of outflows) {
    const splitsForTransaction = splitsByTransaction.get(row.transactionId);
    if (splitsForTransaction && splitsForTransaction.length > 0) {
      for (const split of splitsForTransaction) {
        totalsByAllocation[split.allocationType] += split.amountMinor;
      }
      continue;
    }

    if (!row.category) {
      uncategorizedMinor += row.effectMinor;
      uncategorizedCount += 1;
      continue;
    }

    // Effective-dated per transaction, not per budget period, so a later
    // re-map never rewrites a closed period. A category's *first-ever*
    // mapping is stored with an epoch effective_from by the write path
    // (web/app/budgets/categories/actions.ts) precisely so it covers
    // spend already recorded - do not "fix" this to ignore the dates.
    const mapping = mappings.find((m) =>
      m.category === row.category &&
      m.effectiveFrom <= row.occurredAtDateKey &&
      (m.effectiveUntil === null || m.effectiveUntil >= row.occurredAtDateKey)
    );

    if (!mapping) {
      unmappedMinor += row.effectMinor;
      unmappedCount += 1;
      continue;
    }

    totalsByAllocation[mapping.allocationType] += row.effectMinor;
  }

  return {
    totalsByAllocation,
    unmappedMinor,
    unmappedCount,
    uncategorizedMinor,
    uncategorizedCount,
  };
}

/**
 * `monthlyTotals` should contain only the complete months that actually
 * had qualifying income (an empty month contributes nothing and is
 * simply omitted by the caller, not included as a zero) - see
 * getVariableIncomeMonths() in web/lib/queries.ts. Handles insufficient
 * history explicitly: zero qualifying months yields averageMinor=null,
 * falling back to expectedMonthlyMinor alone (or null if that's absent
 * too) - never a fabricated average of nothing.
 */
export function computeVariableIncomeRecommendation(
  monthlyTotals: bigint[],
  expectedMonthlyMinor: bigint | null,
): VariableIncomeRecommendation {
  if (monthlyTotals.length === 0) {
    return {
      averageMinor: null,
      recommendedMinor: expectedMonthlyMinor,
      monthsUsed: 0,
    };
  }

  const sum = monthlyTotals.reduce((total, m) => total + m, 0n);
  const averageMinor = divRoundBigInt(sum, BigInt(monthlyTotals.length));

  const recommendedMinor = expectedMonthlyMinor !== null
    ? (expectedMonthlyMinor < averageMinor
      ? expectedMonthlyMinor
      : averageMinor)
    : averageMinor;

  return { averageMinor, recommendedMinor, monthsUsed: monthlyTotals.length };
}
