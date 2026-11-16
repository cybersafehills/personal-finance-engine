import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  type ReportRunInput,
  toMobileReport,
  toMobileReportListItem,
} from "./mobile-reports.ts";
import type { ReportPayload } from "./report-types.ts";

// 24 Aug 2026 00:00 in Kigali (UTC+2) is 23 Aug 22:00 UTC.
const PERIOD = "2026-08-23T22:00:00Z";
const GENERATED = "2026-08-24T22:07:00Z";

const payload = (over: Partial<ReportPayload> = {}): ReportPayload => ({
  schemaVersion: 1,
  dateKey: "2026-08-24",
  timezone: "Africa/Kigali",
  financialSnapshot: {
    openingBalanceRwf: 100000,
    closingBalanceRwf: 120000,
    moneyReceivedRwf: 50000,
    moneySpentRwf: 30000,
    feesRwf: 400,
    netMovementRwf: 20000,
    transactionCount: 7,
    categorizedCount: 5,
    uncategorizedCount: 2,
    largestInflowRwf: 50000,
    largestOutflowRwf: 15000,
  },
  categoryTotals: [
    {
      category: "Food",
      amountRwf: 20000,
      transactionCount: 4,
      percentOfSpending: 66.6,
    },
    {
      category: "Uncategorized",
      amountRwf: 10000,
      transactionCount: 2,
      percentOfSpending: 33.3,
    },
  ],
  trends: [
    {
      metric: "spend",
      label: "Spending",
      currentValue: 30000,
      comparisonValue: 25000,
      changePercent: 20,
    },
    {
      metric: "income",
      label: "Income",
      currentValue: 50000,
      comparisonValue: 40000,
      changePercent: 25,
    },
    {
      metric: "fees",
      label: "Fees",
      currentValue: 400,
      comparisonValue: 500,
      changePercent: -20,
    },
    {
      metric: "transaction_count",
      label: "Transactions",
      currentValue: 7,
      comparisonValue: 5,
      changePercent: 40,
    },
  ],
  alerts: [
    {
      id: "a1",
      kind: "large_transaction",
      severity: "watch",
      transactionId: "t1",
      amountRwf: 15000,
      thresholdRwf: 10000,
    },
    {
      id: "a2",
      kind: "high_daily_spend",
      severity: "warning",
      spentRwf: 30000,
      thresholdRwf: 20000,
    },
  ],
  budget: {
    budgetId: "b1",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    overallStatus: "watch",
    allocations: [
      {
        allocationType: "WANTS",
        targetMinor: 100000,
        actualMinor: 82000,
        remainingMinor: 18000,
        percentConsumed: 82,
        projectedMinor: 120000,
        status: "watch",
      },
    ],
    alerts: [
      {
        id: "b-a1",
        kind: "allocation_exceeded",
        severity: "critical",
        allocationType: "WANTS",
        actualMinor: 120000,
        targetMinor: 100000,
      },
    ],
  },
  forecast: {
    method: "rolling_average_times_remaining_days",
    basisDailyAverageRwf: 1000,
    daysElapsed: 24,
    daysRemaining: 7,
    monthToDateSpentRwf: 24000,
    projectedMonthEndSpendRwf: 31000.6,
    disclaimer: "A projection, not a promise.",
  },
  ...over,
});

const run = (over: Partial<ReportRunInput> = {}): ReportRunInput => ({
  id: "r1",
  period_start: PERIOD,
  timezone: "Africa/Kigali",
  status: "generated",
  generated_at: GENERATED,
  report_payload: payload(),
  ai_payload: null,
  error_message: null,
  ...over,
});

Deno.test("a list item names the day in the report's own timezone and its status", () => {
  const item = toMobileReportListItem(run())!;
  assertEquals(
    { ...item, generatedLabel: undefined },
    {
      id: "r1",
      dateLabel: "August 24, 2026",
      status: "generated",
      statusLabel: "Generated",
      generatedLabel: undefined,
    },
  );
  // 22:07 UTC is just after midnight in Kigali, on the 25th. The exact clock
  // style (12-hour "12:07 AM" or 24-hour "00:07") is the web formatter's and can
  // differ by runtime locale data, so only the day and the minute are pinned.
  assertMatch(item.generatedLabel!, /^Aug 25, (12:07 AM|00:07)$/);
});

Deno.test("the same instant is a different day in another timezone (the report's own wins)", () => {
  assertEquals(
    toMobileReportListItem(run({ timezone: "UTC" }))?.dateLabel,
    "August 23, 2026",
  );
});

Deno.test("a report that was never generated has no generated label", () => {
  assertEquals(
    toMobileReportListItem(run({ generated_at: null, status: "scheduled" }))
      ?.generatedLabel,
    null,
  );
});

Deno.test("an unknown status or an unrecognised timezone is dropped, never shown wrongly", () => {
  assertEquals(toMobileReportListItem(run({ status: "weird" })), null);
  assertEquals(toMobileReportListItem(run({ timezone: "Not/AZone" })), null);
  assertEquals(toMobileReport(run({ status: "weird" })), null);
  assertEquals(toMobileReport(run({ timezone: "Not/AZone" })), null);
});

Deno.test("every status reads like the web's badge", () => {
  const labels = [
    "scheduled",
    "generating",
    "generated",
    "generation_failed",
    "delivery_pending",
    "delivering",
    "delivered",
    "delivery_failed",
  ]
    .map((status) => toMobileReportListItem(run({ status }))?.statusLabel);
  assertEquals(labels, [
    "Scheduled",
    "Generating",
    "Generated",
    "Generation failed",
    "Delivery pending",
    "Sending",
    "Delivered",
    "Delivery failed",
  ]);
});

Deno.test("the detail carries the stored snapshot, category rows and a document flag", () => {
  const r = toMobileReport(run())!;
  assertEquals(r.hasDocument, true);
  assertEquals(r.snapshot?.closingBalanceRwf, 120000);
  assertEquals(r.snapshot?.netMovementRwf, 20000);
  assertEquals(r.categories.map((c) => c.category), ["Food", "Uncategorized"]);
  assertEquals(r.forecast, {
    projectedMonthEndSpendRwf: 31001,
    disclaimer: "A projection, not a promise.",
  });
});

Deno.test("trend colours: spending and fees up are bad, income up is good, a count is neutral", () => {
  const trends = toMobileReport(run())!.trends;
  assertEquals(trends.map((t) => [t.label, t.changePercent, t.tone]), [
    ["Spending", 20, "negative"], // spending rose
    ["Income", 25, "positive"], // income rose
    ["Fees", -20, "positive"], // fees fell
    ["Transactions", 40, "neutral"],
  ]);
  assertEquals(trends[0].valueLabel, "30,000 RWF");
  assertEquals(trends[3].valueLabel, "7"); // a count, not money
});

Deno.test("trends without history are left out, and a change against zero reads as neutral", () => {
  const r = toMobileReport(run({
    report_payload: payload({
      trends: [
        {
          metric: "spend",
          label: "Spending",
          currentValue: 1,
          comparisonValue: null,
          changePercent: null,
        },
        {
          metric: "income",
          label: "Income",
          currentValue: 9,
          comparisonValue: 0,
          changePercent: null,
        },
      ],
    }),
  }))!;
  assertEquals(r.trends.map((t) => [t.label, t.tone]), [["Income", "neutral"]]);
});

Deno.test("alerts are the web's own sentences, report alerts then budget alerts, with a tone", () => {
  const alerts = toMobileReport(run())!.alerts;
  assertEquals(alerts.map((a) => a.tone), [
    "neutral",
    "attention",
    "attention",
  ]);
  assertEquals(
    alerts[0].message,
    "A large transaction of 15,000 RWF was recorded (over your 10,000 RWF threshold).",
  );
  assertEquals(
    alerts[1].message,
    "Total spending today (30,000 RWF) was higher than usual.",
  );
  assertEquals(
    alerts[2].message,
    "Wants exceeded its target: 120,000 RWF of 100,000 RWF.",
  );
});

Deno.test("budget allocations carry the web's labels", () => {
  assertEquals(toMobileReport(run())!.budget?.allocations[0], {
    type: "WANTS",
    label: "Wants",
    targetMinor: 100000,
    actualMinor: 82000,
    remainingMinor: 18000,
    percentConsumed: 82,
    projectedMinor: 120000,
    status: "watch",
  });
});

Deno.test("with no active budget there is no budget section and no budget alerts", () => {
  const r = toMobileReport(
    run({
      report_payload: payload({
        budget: { overallStatus: "no_active_budget" },
      }),
    }),
  )!;
  assertEquals(r.budget, null);
  assertEquals(r.alerts.length, 2);
});

Deno.test("no forecast and no AI commentary are simply absent", () => {
  const r = toMobileReport(
    run({ report_payload: payload({ forecast: null }) }),
  )!;
  assertEquals([r.forecast, r.insights], [null, null]);
});

Deno.test("AI insights come through when present", () => {
  const r = toMobileReport(run({
    ai_payload: {
      summary: "Spending was steady.",
      observations: ["Food led."],
      provider: "anthropic",
      model: "m",
      generatedAt: GENERATED,
    },
  }))!;
  assertEquals(r.insights, {
    summary: "Spending was steady.",
    observations: ["Food led."],
  });
});

Deno.test("a report with no payload yet has nothing to download or show", () => {
  const r = toMobileReport(
    run({ report_payload: null, status: "scheduled", generated_at: null }),
  )!;
  assertEquals([r.hasDocument, r.snapshot, r.categories, r.trends, r.alerts], [
    false,
    null,
    [],
    [],
    [],
  ]);
});

Deno.test("a failed generation carries its reason, capped", () => {
  const r = toMobileReport(
    run({
      report_payload: null,
      status: "generation_failed",
      error_message: "x".repeat(500),
    }),
  )!;
  assertEquals(r.errorMessage?.length, 300);
  assertEquals(r.statusLabel, "Generation failed");
});
