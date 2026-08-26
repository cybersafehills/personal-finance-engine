// Deterministic alert -> human-readable sentence rendering, shared
// between the Reports UI (components/ReportWatchOutsList.tsx) and the
// morning email renderer (report-delivery.ts / lib/emails.ts) so the two
// surfaces never drift into two different wordings for the same alert -
// one implementation, two renderers reading the same sentence text.
// Zero database/React dependency - pure string formatting only.

import { formatRwf } from "./format.ts";
import type { ReportAlert } from "./report-math.ts";
import type { BudgetAlertJson } from "./report-types.ts";
import type { AllocationType } from "./budget-math.ts";

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

export function reportAlertMessage(alert: ReportAlert): string {
  switch (alert.kind) {
    case "large_transaction":
      return `A large transaction of ${
        formatRwf(alert.amountRwf)
      } was recorded (over your ${formatRwf(alert.thresholdRwf)} threshold).`;
    case "high_daily_spend":
      return `Total spending today (${
        formatRwf(alert.spentRwf)
      }) was higher than usual.`;
    case "elevated_fees":
      return `Fees today (${formatRwf(alert.feesRwf)}) were higher than usual.`;
    case "low_balance":
      return `Your balance (${formatRwf(alert.balanceRwf)}) is at or below ${
        formatRwf(alert.thresholdRwf)
      }.`;
    case "sustained_negative_cashflow":
      return `You've spent more than you've received for ${alert.consecutiveDays} days in a row.`;
    case "excessive_uncategorized":
      return `${alert.count} transaction${
        alert.count === 1 ? " is" : "s are"
      } uncategorized (${
        Math.round(alert.percentOfTransactions)
      }% of today's activity).`;
  }
}

export function budgetAlertMessage(alert: BudgetAlertJson): string {
  switch (alert.kind) {
    case "allocation_watch":
      return `${ALLOCATION_LABELS[alert.allocationType]} has used ${
        Math.round(alert.percentConsumed)
      }% of its target.`;
    case "allocation_at_risk":
      return `${
        ALLOCATION_LABELS[alert.allocationType]
      } is nearing its limit - ${Math.round(alert.percentConsumed)}% used.`;
    case "allocation_exceeded":
      return `${ALLOCATION_LABELS[alert.allocationType]} exceeded its target: ${
        formatRwf(alert.actualMinor)
      } of ${formatRwf(alert.targetMinor)}.`;
    case "unmapped_spending":
      return `${alert.count} unmapped transaction${
        alert.count === 1 ? "" : "s"
      } (${
        formatRwf(alert.totalMinor)
      }) aren't counted in any budget allocation.`;
    case "uncategorized_spending":
      return `${alert.count} uncategorized transaction${
        alert.count === 1 ? "" : "s"
      } (${
        formatRwf(alert.totalMinor)
      }) aren't counted in any budget allocation.`;
    case "income_below_budget":
      return `Actual income (${formatRwf(alert.actualMinor)}) is ${
        Math.round(alert.shortfallPercent)
      }% below the budgeted ${formatRwf(alert.budgetedMinor)}.`;
  }
}

export function allocationLabel(type: AllocationType): string {
  return ALLOCATION_LABELS[type];
}
