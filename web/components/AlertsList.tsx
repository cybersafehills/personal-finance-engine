import Link from "next/link";
import type { SupportedCurrency } from "../lib/money";
import type { BudgetAlert } from "../lib/budget-math";
import { budgetAlertMessage } from "../lib/budget-alert-text";

const SEVERITY_CLASSES: Record<BudgetAlert["severity"], string> = {
  info: "bg-background text-text-secondary",
  warning: "bg-attention-bg text-attention",
  critical: "bg-attention-bg text-attention",
};

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
        const message = budgetAlertMessage(alert, currency);
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
