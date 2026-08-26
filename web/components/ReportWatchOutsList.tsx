import { reportAlertMessage, budgetAlertMessage } from "../lib/report-alert-messages";
import type { ReportAlert } from "../lib/report-math";
import type { BudgetAlertJson } from "../lib/report-types";

// Combines the report engine's two independent alert sources - deterministic
// transaction-activity alerts (report-math.ts) and the budget section's own
// allocation alerts (budget-math.ts, converted to plain numbers at the
// report-generation.ts boundary - see that module's comment) - into the
// single "Watch-outs" section the report UX calls for (master prompt §67).
// Both stay deterministic; nothing here is AI-generated (master prompt §5).
// Message text itself lives in lib/report-alert-messages.ts, shared with
// the morning email renderer so the two surfaces never word an alert
// differently.

const SEVERITY_CLASSES: Record<string, string> = {
  info: "bg-background text-text-secondary",
  watch: "bg-background text-text-secondary",
  warning: "bg-attention-bg text-attention",
  critical: "bg-attention-bg text-attention",
};

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
