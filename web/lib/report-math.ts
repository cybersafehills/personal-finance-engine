// Deterministic Daily Financial Report calculation engine (master prompt
// §5/§6/§7: "financial facts before AI" - every number in a report comes
// from here or from budget-math.ts, never from an LLM). Zero imports so
// this can be unit-tested with `deno test`, matching budget-math.ts/
// money.ts's established pattern for pure financial logic.
//
// This module NEVER queries a database and NEVER duplicates the
// canonical accounting effect calculation (supabase/functions/_shared/
// accounting.ts) or the canonical budget-vs-actual calculation
// (budget-math.ts) - master prompt §64 ("no parallel financial logic").
// Every function here takes already-fetched, already-accounting-processed
// facts (settlement_state = 'settled' transactions with their
// principal_effect_rwf/fee_effect_rwf already computed by the accounting
// engine) and derives report-specific aggregates/alerts/trends from them.
// Fetching those facts with correct workspace/user/account scoping is the
// generation job's responsibility (Phase D), not this module's.
//
// Amounts here are plain `number` RWF (not bigint minor units) to match
// this repository's existing transactions-side convention
// (web/lib/queries.ts's getCategoryTotals/getTodayTotals), which is
// deliberately different from budget-math.ts's bigint-minor-units
// convention (transactions are RWF-only/0-decimal-place; budgets support
// EUR/USD too - see budget-math.ts's and budgets' own migration
// comments). A report's budget section embeds budget-math's own bigint
// types unchanged rather than converting them, so no precision is ever
// lost crossing that boundary.

export type ReportDirection = "in" | "out" | "neutral";

/**
 * The minimal shape this module needs from a transaction row. Callers
 * must pre-filter to `settlement_state = 'settled'` (the accounting
 * engine's own definition of "counts toward balances/totals") before
 * passing rows in - this module has no way to re-derive that itself and
 * deliberately does not accept unsettled rows as input.
 */
export type ReportTransactionFact = {
  id: string;
  direction: ReportDirection;
  /** Signed, already computed by the accounting engine. */
  principalEffectRwf: number;
  /** Signed (<= 0), already computed by the accounting engine. */
  feeEffectRwf: number;
  category: string | null;
  counterpartyName: string | null;
  occurredAt: string;
};

const UNCATEGORIZED_LABEL = "Uncategorized";

function totalEffect(t: ReportTransactionFact): number {
  return t.principalEffectRwf + t.feeEffectRwf;
}

// ---------------------------------------------------------------------------
// Financial snapshot
// ---------------------------------------------------------------------------

export type FinancialSnapshot = {
  openingBalanceRwf: number | null;
  closingBalanceRwf: number | null;
  moneyReceivedRwf: number;
  moneySpentRwf: number;
  feesRwf: number;
  netMovementRwf: number;
  transactionCount: number;
  categorizedCount: number;
  uncategorizedCount: number;
  largestInflowRwf: number | null;
  largestOutflowRwf: number | null;
};

/**
 * `openingBalanceRwf`/`closingBalanceRwf` must come from the canonical
 * provider-reported balance source (master prompt §31 - never a second
 * running-balance algorithm computed here). Pass `null` for either when no
 * trustworthy value exists yet (e.g. a brand-new account) - this module
 * never fabricates one.
 */
export function computeFinancialSnapshot(
  transactions: ReportTransactionFact[],
  openingBalanceRwf: number | null,
  closingBalanceRwf: number | null,
): FinancialSnapshot {
  let moneyReceivedRwf = 0;
  let moneySpentRwf = 0;
  let feesRwf = 0;
  let categorizedCount = 0;
  let uncategorizedCount = 0;
  let largestInflowRwf: number | null = null;
  let largestOutflowRwf: number | null = null;

  for (const t of transactions) {
    feesRwf += Math.abs(t.feeEffectRwf);

    if (t.direction === "in") {
      const amount = t.principalEffectRwf;
      moneyReceivedRwf += amount;
      if (largestInflowRwf === null || amount > largestInflowRwf) {
        largestInflowRwf = amount;
      }
    } else if (t.direction === "out") {
      const amount = Math.abs(totalEffect(t));
      moneySpentRwf += amount;
      if (largestOutflowRwf === null || amount > largestOutflowRwf) {
        largestOutflowRwf = amount;
      }
    }

    if (t.category === null || t.category.trim() === "") {
      uncategorizedCount += 1;
    } else {
      categorizedCount += 1;
    }
  }

  const netMovementRwf = transactions.reduce(
    (sum, t) => sum + totalEffect(t),
    0,
  );

  return {
    openingBalanceRwf,
    closingBalanceRwf,
    moneyReceivedRwf,
    moneySpentRwf,
    feesRwf,
    netMovementRwf,
    transactionCount: transactions.length,
    categorizedCount,
    uncategorizedCount,
    largestInflowRwf,
    largestOutflowRwf,
  };
}

// ---------------------------------------------------------------------------
// Category analysis - outgoing transactions only, matching
// web/lib/queries.ts's getCategoryTotals convention. Explicit
// "Uncategorized" bucket rather than guessing (master prompt §7).
// ---------------------------------------------------------------------------

export type CategoryTotal = {
  category: string;
  amountRwf: number;
  transactionCount: number;
  /** 0-100. Always 0 when there is no outgoing spend at all (never NaN/null). */
  percentOfSpending: number;
};

export function computeCategoryTotals(
  transactions: ReportTransactionFact[],
): CategoryTotal[] {
  const totals = new Map<
    string,
    { amountRwf: number; transactionCount: number }
  >();

  for (const t of transactions) {
    if (t.direction !== "out") continue;
    const key = t.category?.trim() || UNCATEGORIZED_LABEL;
    const amount = Math.abs(totalEffect(t));
    const existing = totals.get(key) ?? { amountRwf: 0, transactionCount: 0 };
    totals.set(key, {
      amountRwf: existing.amountRwf + amount,
      transactionCount: existing.transactionCount + 1,
    });
  }

  const grandTotal = Array.from(totals.values()).reduce(
    (sum, v) => sum + v.amountRwf,
    0,
  );

  return Array.from(totals.entries())
    .map(([category, { amountRwf, transactionCount }]) => ({
      category,
      amountRwf,
      transactionCount,
      percentOfSpending: grandTotal > 0 ? (amountRwf / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amountRwf - a.amountRwf);
}

// ---------------------------------------------------------------------------
// Trend analysis - simple, transparent rolling comparisons (master prompt
// §7: "do not build complicated predictive infrastructure"). Every
// comparison value the caller can't yet supply (insufficient history) must
// be passed as `null`, never a fabricated 0 - this module treats null
// as "not enough history" and reports no misleading percentage for it.
// ---------------------------------------------------------------------------

export type TrendMetric = "spend" | "income" | "fees" | "transaction_count";

export type TrendComparison = {
  metric: TrendMetric;
  label: string;
  currentValue: number;
  /** null = insufficient history for this comparison. */
  comparisonValue: number | null;
  /** null whenever comparisonValue is null, or comparisonValue is 0 (a percent change against zero is meaningless, not "infinite%"). */
  changePercent: number | null;
};

function trendComparison(
  metric: TrendMetric,
  label: string,
  currentValue: number,
  comparisonValue: number | null,
): TrendComparison {
  const changePercent = comparisonValue !== null && comparisonValue !== 0
    ? ((currentValue - comparisonValue) / Math.abs(comparisonValue)) * 100
    : null;
  return { metric, label, currentValue, comparisonValue, changePercent };
}

export type TrendInput = {
  todaySpentRwf: number;
  /** Average of however many of the trailing 7 days actually have data; null if zero prior days exist. */
  rolling7DayAvgSpentRwf: number | null;
  todayReceivedRwf: number;
  rolling7DayAvgReceivedRwf: number | null;
  todayFeesRwf: number;
  rolling7DayAvgFeesRwf: number | null;
  todayTransactionCount: number;
  rolling7DayAvgTransactionCount: number | null;
};

/** "Today vs rolling 7-day average" comparisons - the master prompt's suggested first-generation trend set (§7). */
export function computeTrends(input: TrendInput): TrendComparison[] {
  return [
    trendComparison(
      "spend",
      "Spending vs. 7-day average",
      input.todaySpentRwf,
      input.rolling7DayAvgSpentRwf,
    ),
    trendComparison(
      "income",
      "Income vs. 7-day average",
      input.todayReceivedRwf,
      input.rolling7DayAvgReceivedRwf,
    ),
    trendComparison(
      "fees",
      "Fees vs. 7-day average",
      input.todayFeesRwf,
      input.rolling7DayAvgFeesRwf,
    ),
    trendComparison(
      "transaction_count",
      "Transaction count vs. 7-day average",
      input.todayTransactionCount,
      input.rolling7DayAvgTransactionCount,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Report alerts - deterministic, restrained (master prompt §69: avoid
// notification fatigue). Distinct from budget-math.ts's BudgetAlert
// (allocation-specific) - these cover the transaction-activity conditions
// master prompt §7 lists (large transaction, high daily spend, elevated
// fees, low balance, sustained negative cash movement, excessive
// uncategorized). All thresholds are explicit inputs, never hardcoded
// magic numbers, per master prompt §7's "thresholds should be explicit,
// configurable where appropriate" requirement.
// ---------------------------------------------------------------------------

export type ReportAlertSeverity = "info" | "watch" | "warning" | "critical";

export type ReportAlert =
  | {
    id: string;
    kind: "large_transaction";
    severity: "watch";
    transactionId: string;
    amountRwf: number;
    thresholdRwf: number;
  }
  | {
    id: string;
    kind: "high_daily_spend";
    severity: "warning";
    spentRwf: number;
    thresholdRwf: number;
  }
  | {
    id: string;
    kind: "elevated_fees";
    severity: "info";
    feesRwf: number;
    thresholdRwf: number;
  }
  | {
    id: string;
    kind: "low_balance";
    severity: "critical";
    balanceRwf: number;
    thresholdRwf: number;
  }
  | {
    id: string;
    kind: "sustained_negative_cashflow";
    severity: "warning";
    consecutiveDays: number;
  }
  | {
    id: string;
    kind: "excessive_uncategorized";
    severity: "info";
    count: number;
    percentOfTransactions: number;
  };

export type ReportAlertThresholds = {
  largeTransactionRwf: number;
  highDailySpendRwf: number;
  elevatedFeesRwf: number;
  /** null = no low-balance check configured (e.g. no reliable balance source yet). */
  lowBalanceRwf: number | null;
  /** Minimum consecutive days of negative net movement (inclusive of today) before alerting. */
  sustainedNegativeCashflowDays: number;
  /** 0-100. */
  uncategorizedPercentThreshold: number;
};

/**
 * The system defaults every daily report falls back to. Historically
 * these lived as a private const in report-generation.ts; they moved here
 * (next to the type they satisfy, in the zero-import pure module) once
 * per-user overrides were added, so both the resolver below and the
 * settings UI can share one definition (master prompt §64 - no duplicated
 * financial constants).
 */
export const DEFAULT_ALERT_THRESHOLDS: ReportAlertThresholds = {
  largeTransactionRwf: 100_000,
  highDailySpendRwf: 200_000,
  elevatedFeesRwf: 5_000,
  lowBalanceRwf: 10_000,
  sustainedNegativeCashflowDays: 3,
  uncategorizedPercentThreshold: 50,
};

/**
 * A report_preferences row's alert-threshold columns as stored (snake_case,
 * each independently nullable). See migration
 * 20261125000000_report_alert_thresholds.sql.
 */
export type StoredAlertThresholds = {
  alert_large_transaction_rwf: number | null;
  alert_high_daily_spend_rwf: number | null;
  alert_elevated_fees_rwf: number | null;
  alert_low_balance_rwf: number | null;
  alert_sustained_negative_cashflow_days: number | null;
  alert_uncategorized_percent: number | null;
};

/**
 * Map a stored preferences row to the runtime ReportAlertThresholds the
 * calculation engine consumes. Any missing column (an older row read
 * before the migration, or a partial select) falls back to
 * DEFAULT_ALERT_THRESHOLDS.
 *
 * `alert_low_balance_rwf` is special: a stored `null` is a deliberate
 * "disable the low-balance check" (lowBalanceRwf = null), NOT "use the
 * default" - only `undefined` (column absent) falls back.
 */
export function resolveAlertThresholds(
  stored: Partial<StoredAlertThresholds> | null | undefined,
): ReportAlertThresholds {
  const s = stored ?? {};
  return {
    largeTransactionRwf:
      s.alert_large_transaction_rwf ?? DEFAULT_ALERT_THRESHOLDS.largeTransactionRwf,
    highDailySpendRwf:
      s.alert_high_daily_spend_rwf ?? DEFAULT_ALERT_THRESHOLDS.highDailySpendRwf,
    elevatedFeesRwf:
      s.alert_elevated_fees_rwf ?? DEFAULT_ALERT_THRESHOLDS.elevatedFeesRwf,
    lowBalanceRwf:
      s.alert_low_balance_rwf === undefined
        ? DEFAULT_ALERT_THRESHOLDS.lowBalanceRwf
        : s.alert_low_balance_rwf,
    sustainedNegativeCashflowDays:
      s.alert_sustained_negative_cashflow_days ??
      DEFAULT_ALERT_THRESHOLDS.sustainedNegativeCashflowDays,
    uncategorizedPercentThreshold:
      s.alert_uncategorized_percent ??
      DEFAULT_ALERT_THRESHOLDS.uncategorizedPercentThreshold,
  };
}

export type ReportAlertInput = {
  transactions: ReportTransactionFact[];
  snapshot: FinancialSnapshot;
  /**
   * Consecutive days (including today) with net movement < 0, precomputed
   * by the caller from report history - this module has no access to
   * prior reports itself.
   */
  consecutiveNegativeDays: number;
  thresholds: ReportAlertThresholds;
};

export function computeReportAlerts(input: ReportAlertInput): ReportAlert[] {
  const alerts: ReportAlert[] = [];
  const { snapshot, thresholds } = input;

  for (const t of input.transactions) {
    if (t.direction !== "out") continue;
    const amount = Math.abs(totalEffect(t));
    if (amount >= thresholds.largeTransactionRwf) {
      alerts.push({
        id: `large-transaction-${t.id}`,
        kind: "large_transaction",
        severity: "watch",
        transactionId: t.id,
        amountRwf: amount,
        thresholdRwf: thresholds.largeTransactionRwf,
      });
    }
  }

  if (snapshot.moneySpentRwf >= thresholds.highDailySpendRwf) {
    alerts.push({
      id: "high-daily-spend",
      kind: "high_daily_spend",
      severity: "warning",
      spentRwf: snapshot.moneySpentRwf,
      thresholdRwf: thresholds.highDailySpendRwf,
    });
  }

  if (snapshot.feesRwf >= thresholds.elevatedFeesRwf) {
    alerts.push({
      id: "elevated-fees",
      kind: "elevated_fees",
      severity: "info",
      feesRwf: snapshot.feesRwf,
      thresholdRwf: thresholds.elevatedFeesRwf,
    });
  }

  if (
    thresholds.lowBalanceRwf !== null &&
    snapshot.closingBalanceRwf !== null &&
    snapshot.closingBalanceRwf <= thresholds.lowBalanceRwf
  ) {
    alerts.push({
      id: "low-balance",
      kind: "low_balance",
      severity: "critical",
      balanceRwf: snapshot.closingBalanceRwf,
      thresholdRwf: thresholds.lowBalanceRwf,
    });
  }

  if (
    input.consecutiveNegativeDays >= thresholds.sustainedNegativeCashflowDays
  ) {
    alerts.push({
      id: "sustained-negative-cashflow",
      kind: "sustained_negative_cashflow",
      severity: "warning",
      consecutiveDays: input.consecutiveNegativeDays,
    });
  }

  if (snapshot.transactionCount > 0) {
    const uncategorizedPercent =
      (snapshot.uncategorizedCount / snapshot.transactionCount) * 100;
    if (uncategorizedPercent >= thresholds.uncategorizedPercentThreshold) {
      alerts.push({
        id: "excessive-uncategorized",
        kind: "excessive_uncategorized",
        severity: "info",
        count: snapshot.uncategorizedCount,
        percentOfTransactions: uncategorizedPercent,
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Forecast - intentionally simple and transparent (master prompt §7):
// rolling daily average x remaining days in the period. Always labeled as
// a projection, never a guarantee (master prompt §68).
// ---------------------------------------------------------------------------

export type Forecast = {
  method: "rolling_average_times_remaining_days";
  basisDailyAverageRwf: number;
  daysElapsed: number;
  daysRemaining: number;
  monthToDateSpentRwf: number;
  projectedMonthEndSpendRwf: number;
  disclaimer: string;
};

const FORECAST_DISCLAIMER =
  "This is a projection based on recent spending, not a guaranteed outcome.";

/**
 * `daysElapsed` must be >= 1 (there is always at least "today" if this is
 * being computed) and `daysInMonth` must be >= `daysElapsed`. Returns null
 * only when daysElapsed is 0 (guards the division; should not occur in
 * practice for a daily report generated after at least one day).
 */
export function computeMonthEndForecast(
  monthToDateSpentRwf: number,
  daysElapsed: number,
  daysInMonth: number,
): Forecast | null {
  if (daysElapsed <= 0) return null;
  const basisDailyAverageRwf = monthToDateSpentRwf / daysElapsed;
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  return {
    method: "rolling_average_times_remaining_days",
    basisDailyAverageRwf,
    daysElapsed,
    daysRemaining,
    monthToDateSpentRwf,
    projectedMonthEndSpendRwf: monthToDateSpentRwf +
      basisDailyAverageRwf * daysRemaining,
    disclaimer: FORECAST_DISCLAIMER,
  };
}
