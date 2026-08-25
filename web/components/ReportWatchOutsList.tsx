import { formatRwf } from "../lib/format";
import type { ReportAlert } from "../lib/report-math";
import type { BudgetAlertJson } from "../lib/report-generation";
import type { AllocationType } from "../lib/budget-math";

// Combines the report engine's two independent alert sources - deterministic
// transaction-activity alerts (report-math.ts) and the budget section's own
// allocation alerts (budget-math.ts, converted to plain numbers at the
// report-generation.ts boundary - see that module's comment) - into the
// single "Watch-outs" section the report UX calls for (master prompt §67).
// Both stay deterministic; nothing here is AI-generated (master prompt §5).

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

const SEVERITY_CLASSES: Record<string, string> = {
  info: "bg-background text-text-secondary",
  watch: "bg-background text-text-secondary",
  warning: "bg-attention-bg text-attention",
  critical: "bg-attention-bg text-attention",
};

function reportAlertMessage(alert: ReportAlert): string {
  switch (alert.kind) {
    case "large_transaction":
      return `A large transaction of ${formatRwf(alert.amountRwf)} was recorded (over your ${
        formatRwf(alert.thresholdRwf)
      } threshold).`;
    case "high_daily_spend":
      return `Total spending today (${formatRwf(alert.spentRwf)}) was higher than usual.`;
    case "elevated_fees":
      return `Fees today (${formatRwf(alert.feesRwf)}) were higher than usual.`;
    case "low_balance":
      return `Your balance (${formatRwf(alert.balanceRwf)}) is at or below ${formatRwf(alert.thresholdRwf)}.`;
    case "sustained_negative_cashflow":
      return `You've spent more than you've received for ${alert.consecutiveDays} days in a row.`;
    case "excessive_uncategorized":
      return `${alert.count} transaction${alert.count === 1 ? " is" : "s are"} uncategorized (${
        Math.round(alert.percentOfTransactions)
      }% of today's activity).`;
  }
}

function budgetAlertMessage(alert: BudgetAlertJson): string {
  switch (alert.kind) {
    case "allocation_watch":
      return `${ALLOCATION_LABELS[alert.allocationType]} has used ${Math.round(alert.percentConsumed)}% of its target.`;
    case "allocation_at_risk":
      return `${ALLOCATION_LABELS[alert.allocationType]} is nearing its limit - ${Math.round(alert.percentConsumed)}% used.`;
    case "allocation_exceeded":
      return `${ALLOCATION_LABELS[alert.allocationType]} exceeded its target: ${formatRwf(alert.actualMinor)} of ${
        formatRwf(alert.targetMinor)
      }.`;
    case "unmapped_spending":
      return `${alert.count} unmapped transaction${alert.count === 1 ? "" : "s"} (${
        formatRwf(alert.totalMinor)
      }) aren't counted in any budget allocation.`;
    case "uncategorized_spending":
      return `${alert.count} uncategorized transaction${alert.count === 1 ? "" : "s"} (${
        formatRwf(alert.totalMinor)
      }) aren't counted in any budget allocation.`;
    case "income_below_budget":
      return `Actual income (${formatRwf(alert.actualMinor)}) is ${Math.round(alert.shortfallPercent)}% below the budgeted ${
        formatRwf(alert.budgetedMinor)
      }.`;
  }
}

export function ReportWatchOutsList({
  reportAlerts,
  budgetAlerts,
}: {
  reportAlerts: ReportAlert[];
  budgetAlerts: BudgetAlertJson[];
}) {
  if (reportAlerts.length === 0 && budgetAlerts.length === 0) {
    return <p className="text-sm text-text-muted">No financial alerts detected.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {reportAlerts.map((alert) => (
        <p
          key={alert.id}
          className={`rounded-control px-3 py-2 text-sm font-medium ${SEVERITY_CLASSES[alert.severity]}`}
        >
          {reportAlertMessage(alert)}
        </p>
      ))}
      {budgetAlerts.map((alert) => (
        <p
          key={alert.id}
          className={`rounded-control px-3 py-2 text-sm font-medium ${SEVERITY_CLASSES[alert.severity]}`}
        >
          {budgetAlertMessage(alert)}
        </p>
      ))}
    </div>
  );
}
