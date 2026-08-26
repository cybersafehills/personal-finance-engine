import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  computeCategoryTotals,
  computeFinancialSnapshot,
  computeMonthEndForecast,
  computeReportAlerts,
  computeTrends,
  ReportAlertThresholds,
  ReportTransactionFact,
} from "./report-math.ts";

function tx(
  overrides: Partial<ReportTransactionFact> = {},
): ReportTransactionFact {
  return {
    id: crypto.randomUUID(),
    direction: "out",
    principalEffectRwf: -1000,
    feeEffectRwf: 0,
    category: "Shopping",
    counterpartyName: "Test Merchant",
    occurredAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeFinancialSnapshot
// ---------------------------------------------------------------------------

Deno.test("computeFinancialSnapshot: zero transactions produces a clean empty snapshot, no NaN/undefined", () => {
  const snapshot = computeFinancialSnapshot([], 100_000, 100_000);
  assertEquals(snapshot.transactionCount, 0);
  assertEquals(snapshot.moneySpentRwf, 0);
  assertEquals(snapshot.moneyReceivedRwf, 0);
  assertEquals(snapshot.feesRwf, 0);
  assertEquals(snapshot.netMovementRwf, 0);
  assertEquals(snapshot.largestInflowRwf, null);
  assertEquals(snapshot.largestOutflowRwf, null);
  assertEquals(snapshot.uncategorizedCount, 0);
});

Deno.test("computeFinancialSnapshot: only outgoing transactions", () => {
  const snapshot = computeFinancialSnapshot(
    [
      tx({ principalEffectRwf: -4000 }),
      tx({ principalEffectRwf: -1000, feeEffectRwf: -20 }),
    ],
    110_000,
    null,
  );
  assertEquals(snapshot.moneySpentRwf, 5020);
  assertEquals(snapshot.moneyReceivedRwf, 0);
  assertEquals(snapshot.feesRwf, 20);
  assertEquals(snapshot.netMovementRwf, -5020);
  assertEquals(snapshot.largestOutflowRwf, 4000);
  assertEquals(snapshot.openingBalanceRwf, 110_000);
  assertEquals(snapshot.closingBalanceRwf, null);
});

Deno.test("computeFinancialSnapshot: only incoming transactions", () => {
  const snapshot = computeFinancialSnapshot(
    [tx({ direction: "in", principalEffectRwf: 5000, feeEffectRwf: 0 })],
    100_000,
    105_000,
  );
  assertEquals(snapshot.moneyReceivedRwf, 5000);
  assertEquals(snapshot.moneySpentRwf, 0);
  assertEquals(snapshot.netMovementRwf, 5000);
  assertEquals(snapshot.largestInflowRwf, 5000);
  assertEquals(snapshot.largestOutflowRwf, null);
});

Deno.test("computeFinancialSnapshot: mixed activity with fees on both sides", () => {
  const snapshot = computeFinancialSnapshot(
    [
      tx({ direction: "in", principalEffectRwf: 30_000, feeEffectRwf: 0 }),
      tx({ direction: "out", principalEffectRwf: -12_500, feeEffectRwf: -250 }),
    ],
    110_000,
    127_250,
  );
  assertEquals(snapshot.moneyReceivedRwf, 30_000);
  assertEquals(snapshot.moneySpentRwf, 12_750);
  assertEquals(snapshot.feesRwf, 250);
  assertEquals(snapshot.netMovementRwf, 17_250);
  assertEquals(snapshot.closingBalanceRwf, 127_250);
});

Deno.test("computeFinancialSnapshot: one transaction", () => {
  const snapshot = computeFinancialSnapshot(
    [tx({ principalEffectRwf: -750 })],
    null,
    null,
  );
  assertEquals(snapshot.transactionCount, 1);
  assertEquals(snapshot.moneySpentRwf, 750);
});

Deno.test("computeFinancialSnapshot: uncategorized transactions counted separately, null and empty-string category both count as uncategorized", () => {
  const snapshot = computeFinancialSnapshot(
    [tx({ category: null }), tx({ category: "  " }), tx({ category: "Food" })],
    null,
    null,
  );
  assertEquals(snapshot.uncategorizedCount, 2);
  assertEquals(snapshot.categorizedCount, 1);
});

Deno.test("computeFinancialSnapshot: large amounts do not overflow or lose precision (RWF has no fractional units)", () => {
  const snapshot = computeFinancialSnapshot(
    [tx({ direction: "in", principalEffectRwf: 987_654_321, feeEffectRwf: 0 })],
    0,
    987_654_321,
  );
  assertEquals(snapshot.moneyReceivedRwf, 987_654_321);
});

Deno.test("computeFinancialSnapshot: negative net movement is representable (spending exceeds income)", () => {
  const snapshot = computeFinancialSnapshot(
    [
      tx({ direction: "in", principalEffectRwf: 1000, feeEffectRwf: 0 }),
      tx({ direction: "out", principalEffectRwf: -5000, feeEffectRwf: -50 }),
    ],
    null,
    null,
  );
  assertEquals(snapshot.netMovementRwf, -4050);
});

// ---------------------------------------------------------------------------
// computeCategoryTotals
// ---------------------------------------------------------------------------

Deno.test("computeCategoryTotals: zero transactions produces an empty array, not an error", () => {
  assertEquals(computeCategoryTotals([]), []);
});

Deno.test("computeCategoryTotals: multiple categories sum and sort descending by amount", () => {
  const totals = computeCategoryTotals([
    tx({ category: "Food", principalEffectRwf: -3000 }),
    tx({ category: "Food", principalEffectRwf: -2000 }),
    tx({ category: "Transport", principalEffectRwf: -1000 }),
  ]);
  assertEquals(totals[0].category, "Food");
  assertEquals(totals[0].amountRwf, 5000);
  assertEquals(totals[0].transactionCount, 2);
  assertEquals(totals[1].category, "Transport");
  assertEquals(totals[1].amountRwf, 1000);
});

Deno.test("computeCategoryTotals: an explicit Uncategorized bucket is used, never guessed", () => {
  const totals = computeCategoryTotals([
    tx({ category: null, principalEffectRwf: -500 }),
  ]);
  assertEquals(totals[0].category, "Uncategorized");
});

Deno.test("computeCategoryTotals: percentages sum to 100 across all categories", () => {
  const totals = computeCategoryTotals([
    tx({ category: "Food", principalEffectRwf: -2500 }),
    tx({ category: "Transport", principalEffectRwf: -2500 }),
  ]);
  const sum = totals.reduce((s, t) => s + t.percentOfSpending, 0);
  assertEquals(Math.round(sum), 100);
});

Deno.test("computeCategoryTotals: incoming transactions are excluded from spending category totals", () => {
  const totals = computeCategoryTotals([
    tx({
      direction: "in",
      category: "Salary",
      principalEffectRwf: 100_000,
      feeEffectRwf: 0,
    }),
  ]);
  assertEquals(totals, []);
});

// ---------------------------------------------------------------------------
// computeTrends
// ---------------------------------------------------------------------------

Deno.test("computeTrends: insufficient history (null comparison) never produces a changePercent", () => {
  const trends = computeTrends({
    todaySpentRwf: 5000,
    rolling7DayAvgSpentRwf: null,
    todayReceivedRwf: 0,
    rolling7DayAvgReceivedRwf: null,
    todayFeesRwf: 0,
    rolling7DayAvgFeesRwf: null,
    todayTransactionCount: 3,
    rolling7DayAvgTransactionCount: null,
  });
  for (const t of trends) {
    assertEquals(t.comparisonValue, null);
    assertEquals(t.changePercent, null);
  }
});

Deno.test("computeTrends: a zero comparison value never produces a changePercent (avoids a meaningless infinite%)", () => {
  const trends = computeTrends({
    todaySpentRwf: 5000,
    rolling7DayAvgSpentRwf: 0,
    todayReceivedRwf: 0,
    rolling7DayAvgReceivedRwf: 0,
    todayFeesRwf: 0,
    rolling7DayAvgFeesRwf: 0,
    todayTransactionCount: 0,
    rolling7DayAvgTransactionCount: 0,
  });
  const spend = trends.find((t) => t.metric === "spend")!;
  assertEquals(spend.changePercent, null);
});

Deno.test("computeTrends: correctly computes a positive percent increase", () => {
  const trends = computeTrends({
    todaySpentRwf: 6000,
    rolling7DayAvgSpentRwf: 4000,
    todayReceivedRwf: 0,
    rolling7DayAvgReceivedRwf: null,
    todayFeesRwf: 0,
    rolling7DayAvgFeesRwf: null,
    todayTransactionCount: 0,
    rolling7DayAvgTransactionCount: null,
  });
  const spend = trends.find((t) => t.metric === "spend")!;
  assertEquals(spend.changePercent, 50);
});

// ---------------------------------------------------------------------------
// computeReportAlerts
// ---------------------------------------------------------------------------

function baseThresholds(
  overrides: Partial<ReportAlertThresholds> = {},
): ReportAlertThresholds {
  return {
    largeTransactionRwf: 100_000,
    highDailySpendRwf: 200_000,
    elevatedFeesRwf: 5_000,
    lowBalanceRwf: 10_000,
    sustainedNegativeCashflowDays: 3,
    uncategorizedPercentThreshold: 50,
    ...overrides,
  };
}

Deno.test("computeReportAlerts: ordinary activity below every threshold produces no alerts (avoids notification fatigue)", () => {
  const transactions = [tx({ principalEffectRwf: -1000 })];
  const snapshot = computeFinancialSnapshot(transactions, 100_000, 99_000);
  const alerts = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds(),
  });
  assertEquals(alerts, []);
});

Deno.test("computeReportAlerts: a single large transaction triggers large_transaction", () => {
  const transactions = [tx({ principalEffectRwf: -150_000 })];
  const snapshot = computeFinancialSnapshot(transactions, 500_000, 350_000);
  const alerts = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds(),
  });
  const alert = alerts.find((a) => a.kind === "large_transaction");
  assertNotEquals(alert, undefined);
  if (alert?.kind === "large_transaction") {
    assertEquals(alert.amountRwf, 150_000);
  }
});

Deno.test("computeReportAlerts: total daily spend above threshold triggers high_daily_spend even with no single large transaction", () => {
  const transactions = Array.from(
    { length: 5 },
    () => tx({ principalEffectRwf: -50_000 }),
  );
  const snapshot = computeFinancialSnapshot(transactions, 500_000, 250_000);
  const alerts = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds(),
  });
  assertEquals(alerts.some((a) => a.kind === "high_daily_spend"), true);
  assertEquals(alerts.some((a) => a.kind === "large_transaction"), false);
});

Deno.test("computeReportAlerts: elevated fees triggers elevated_fees", () => {
  const transactions = [tx({ principalEffectRwf: -1000, feeEffectRwf: -6000 })];
  const snapshot = computeFinancialSnapshot(transactions, 100_000, 93_000);
  const alerts = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds(),
  });
  assertEquals(alerts.some((a) => a.kind === "elevated_fees"), true);
});

Deno.test("computeReportAlerts: low balance triggers low_balance only when a closing balance is actually known", () => {
  const transactions = [tx({ principalEffectRwf: -1000 })];
  const snapshotWithBalance = computeFinancialSnapshot(
    transactions,
    11_000,
    5_000,
  );
  const alertsWithBalance = computeReportAlerts({
    transactions,
    snapshot: snapshotWithBalance,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds(),
  });
  assertEquals(alertsWithBalance.some((a) => a.kind === "low_balance"), true);

  const snapshotNoBalance = computeFinancialSnapshot(transactions, null, null);
  const alertsNoBalance = computeReportAlerts({
    transactions,
    snapshot: snapshotNoBalance,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds(),
  });
  assertEquals(alertsNoBalance.some((a) => a.kind === "low_balance"), false);
});

Deno.test("computeReportAlerts: low_balance check is skipped entirely when no threshold is configured (null)", () => {
  const transactions = [tx({ principalEffectRwf: -1000 })];
  const snapshot = computeFinancialSnapshot(transactions, 5000, 4000);
  const alerts = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds({ lowBalanceRwf: null }),
  });
  assertEquals(alerts.some((a) => a.kind === "low_balance"), false);
});

Deno.test("computeReportAlerts: sustained negative cashflow fires once the configured number of consecutive days is reached", () => {
  const transactions = [tx({ principalEffectRwf: -1000 })];
  const snapshot = computeFinancialSnapshot(transactions, 100_000, 99_000);
  const belowThreshold = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 2,
    thresholds: baseThresholds(),
  });
  assertEquals(
    belowThreshold.some((a) => a.kind === "sustained_negative_cashflow"),
    false,
  );

  const atThreshold = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 3,
    thresholds: baseThresholds(),
  });
  assertEquals(
    atThreshold.some((a) => a.kind === "sustained_negative_cashflow"),
    true,
  );
});

Deno.test("computeReportAlerts: excessive uncategorized spending is flagged with zero transactions guarded against divide-by-zero", () => {
  const noTransactions = computeFinancialSnapshot([], null, null);
  const noTxAlerts = computeReportAlerts({
    transactions: [],
    snapshot: noTransactions,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds(),
  });
  assertEquals(
    noTxAlerts.some((a) => a.kind === "excessive_uncategorized"),
    false,
  );

  const transactions = [
    tx({ category: null }),
    tx({ category: null }),
    tx({ category: "Food" }),
  ];
  const snapshot = computeFinancialSnapshot(transactions, null, null);
  const alerts = computeReportAlerts({
    transactions,
    snapshot,
    consecutiveNegativeDays: 0,
    thresholds: baseThresholds({ uncategorizedPercentThreshold: 50 }),
  });
  assertEquals(alerts.some((a) => a.kind === "excessive_uncategorized"), true);
});

// ---------------------------------------------------------------------------
// computeMonthEndForecast
// ---------------------------------------------------------------------------

Deno.test("computeMonthEndForecast: zero days elapsed returns null (guards divide-by-zero)", () => {
  assertEquals(computeMonthEndForecast(0, 0, 30), null);
});

Deno.test("computeMonthEndForecast: projects linearly from the daily average", () => {
  const forecast = computeMonthEndForecast(50_000, 5, 30);
  assertNotEquals(forecast, null);
  if (forecast) {
    assertEquals(forecast.basisDailyAverageRwf, 10_000);
    assertEquals(forecast.daysRemaining, 25);
    assertEquals(forecast.projectedMonthEndSpendRwf, 50_000 + 10_000 * 25);
    assertEquals(forecast.disclaimer.length > 0, true);
  }
});

Deno.test("computeMonthEndForecast: the last day of the month has zero days remaining and projects exactly month-to-date", () => {
  const forecast = computeMonthEndForecast(300_000, 30, 30);
  assertNotEquals(forecast, null);
  if (forecast) {
    assertEquals(forecast.daysRemaining, 0);
    assertEquals(forecast.projectedMonthEndSpendRwf, 300_000);
  }
});
