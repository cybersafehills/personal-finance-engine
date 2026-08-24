import Link from "next/link";
import { formatMoney, SupportedCurrency } from "../lib/money";
import type { AllocationType } from "../lib/budget-math";
import type { BudgetAlert } from "../lib/budget-math";

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

const SEVERITY_CLASSES: Record<BudgetAlert["severity"], string> = {
  info: "bg-background text-text-secondary",
  warning: "bg-attention-bg text-attention",
  critical: "bg-attention-bg text-attention",
};

function alertMessage(alert: BudgetAlert, currency: SupportedCurrency): string {
  switch (alert.kind) {
    case "allocation_watch":
      return `${ALLOCATION_LABELS[alert.allocationType]} has used ${Math.round(alert.percentConsumed)}% of its target.`;
    case "allocation_at_risk":
      return `${ALLOCATION_LABELS[alert.allocationType]} is nearing its limit - ${Math.round(alert.percentConsumed)}% used.`;
    case "allocation_exceeded":
      return `${ALLOCATION_LABELS[alert.allocationType]} exceeded its target: ${formatMoney(alert.actualMinor, currency)} of ${formatMoney(alert.targetMinor, currency)}.`;
    case "unmapped_spending":
      return `${alert.count} unmapped transaction${alert.count === 1 ? "" : "s"} (${formatMoney(alert.totalMinor, currency)}) aren't counted in any allocation.`;
    case "uncategorized_spending":
      return `${alert.count} uncategorized transaction${alert.count === 1 ? "" : "s"} (${formatMoney(alert.totalMinor, currency)}) aren't counted in any allocation.`;
    case "income_below_budget":
      return `Actual income (${formatMoney(alert.actualMinor, currency)}) is ${Math.round(alert.shortfallPercent)}% below the budgeted ${formatMoney(alert.budgetedMinor, currency)}.`;
  }
}

function alertHref(alert: BudgetAlert): string | null {
  if (alert.kind === "unmapped_spending" || alert.kind === "uncategorized_spending") {
    return "/budgets/categories";
  }
  return null;
}

export function AlertsList({
  alerts,
  currency,
}: {
  alerts: BudgetAlert[];
  currency: SupportedCurrency;
}) {
  if (alerts.length === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {alerts.map((alert) => {
        const message = alertMessage(alert, currency);
        const href = alertHref(alert);
        const content = (
          <p className={`rounded-control px-3 py-2 text-sm font-medium ${SEVERITY_CLASSES[alert.severity]}`}>
            {message}
            {href && " Review category mappings →"}
          </p>
        );
        return href
          ? <Link key={alert.id} href={href}>{content}</Link>
          : <div key={alert.id}>{content}</div>;
      })}
    </div>
  );
}
