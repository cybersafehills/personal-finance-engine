// The wording of budget alerts, shared by the web (components/AlertsList.tsx)
// and the mobile API (lib/mobile-budgets.ts) so both say exactly the same
// thing. Pure: no server-only or React imports, unit-testable with deno.

import type { AllocationType, BudgetAlert } from "./budget-math.ts";
import { formatMoney, type SupportedCurrency } from "./money.ts";

export const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

export function budgetAlertMessage(
  alert: BudgetAlert,
  currency: SupportedCurrency,
): string {
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
