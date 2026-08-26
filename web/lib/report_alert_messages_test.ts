import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  budgetAlertMessage,
  reportAlertMessage,
} from "./report-alert-messages.ts";
import type { ReportAlert } from "./report-math.ts";
import type { BudgetAlertJson } from "./report-types.ts";

Deno.test("reportAlertMessage: renders a sentence for every alert kind without throwing", () => {
  const alerts: ReportAlert[] = [
    {
      id: "1",
      kind: "large_transaction",
      severity: "watch",
      transactionId: "t1",
      amountRwf: 150_000,
      thresholdRwf: 100_000,
    },
    {
      id: "2",
      kind: "high_daily_spend",
      severity: "warning",
      spentRwf: 250_000,
      thresholdRwf: 200_000,
    },
    {
      id: "3",
      kind: "elevated_fees",
      severity: "info",
      feesRwf: 6_000,
      thresholdRwf: 5_000,
    },
    {
      id: "4",
      kind: "low_balance",
      severity: "critical",
      balanceRwf: 5_000,
      thresholdRwf: 10_000,
    },
    {
      id: "5",
      kind: "sustained_negative_cashflow",
      severity: "warning",
      consecutiveDays: 3,
    },
    {
      id: "6",
      kind: "excessive_uncategorized",
      severity: "info",
      count: 4,
      percentOfTransactions: 60,
    },
  ];

  for (const alert of alerts) {
    const message = reportAlertMessage(alert);
    assertEquals(typeof message, "string");
    assertEquals(message.length > 0, true);
  }
});

Deno.test("reportAlertMessage: includes the formatted amount for a large transaction", () => {
  const message = reportAlertMessage({
    id: "1",
    kind: "large_transaction",
    severity: "watch",
    transactionId: "t1",
    amountRwf: 150_000,
    thresholdRwf: 100_000,
  });
  assertStringIncludes(message, "150,000 RWF");
});

Deno.test("budgetAlertMessage: renders a sentence for every alert kind without throwing", () => {
  const alerts: BudgetAlertJson[] = [
    {
      id: "1",
      kind: "allocation_watch",
      severity: "info",
      allocationType: "WANTS",
      percentConsumed: 80,
    },
    {
      id: "2",
      kind: "allocation_at_risk",
      severity: "warning",
      allocationType: "WANTS",
      percentConsumed: 92,
    },
    {
      id: "3",
      kind: "allocation_exceeded",
      severity: "critical",
      allocationType: "WANTS",
      actualMinor: 350_000,
      targetMinor: 300_000,
    },
    {
      id: "4",
      kind: "unmapped_spending",
      severity: "warning",
      count: 2,
      totalMinor: 10_000,
    },
    {
      id: "5",
      kind: "uncategorized_spending",
      severity: "warning",
      count: 1,
      totalMinor: 5_000,
    },
    {
      id: "6",
      kind: "income_below_budget",
      severity: "warning",
      budgetedMinor: 1_000_000,
      actualMinor: 850_000,
      shortfallPercent: 15,
    },
  ];

  for (const alert of alerts) {
    const message = budgetAlertMessage(alert);
    assertEquals(typeof message, "string");
    assertEquals(message.length > 0, true);
  }
});

Deno.test("budgetAlertMessage: uses the human-readable allocation label, not the raw enum value", () => {
  const message = budgetAlertMessage({
    id: "1",
    kind: "allocation_exceeded",
    severity: "critical",
    allocationType: "EMERGENCY",
    actualMinor: 60_000,
    targetMinor: 50_000,
  });
  assertStringIncludes(message, "Emergency savings");
});
