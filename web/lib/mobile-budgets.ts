// The budget payload for the mobile app (GET /api/mobile/budgets). Pure: it
// reshapes what lib/queries.ts already computed (getBudgetActuals is the one
// canonical aggregation, never reimplemented) into plain JSON. Alerts carry
// bigint amounts, which JSON cannot represent, so they are rendered to the
// same sentences the web shows (lib/budget-alert-text.ts).

import type {
  AllocationStatus,
  AllocationType,
  BudgetAlert,
} from "./budget-math.ts";
import { ALLOCATION_LABELS, budgetAlertMessage } from "./budget-alert-text.ts";
import { isSupportedCurrency, type SupportedCurrency } from "./money.ts";

export type MobileAllocation = {
  type: AllocationType;
  label: string;
  targetMinor: number;
  actualMinor: number;
  remainingMinor: number;
  /** null only when the target is 0 and there is spending against it. */
  percentConsumed: number | null;
  /** null unless the budget is active and today is inside its period. */
  projectedMinor: number | null;
  status: AllocationStatus;
};

export type MobileBudget = {
  id: string;
  name: string;
  currency: SupportedCurrency;
  periodStart: string;
  periodEnd: string;
  /** 0-1 share of the period elapsed, or null outside the period. */
  elapsedFraction: number | null;
  actualIncomeMinor: number;
  allocations: MobileAllocation[];
  alerts: { id: string; severity: "info" | "warning" | "critical"; message: string }[];
  uncategorizedCount: number;
  uncategorizedMinor: number;
  unmappedCount: number;
  unmappedMinor: number;
};

export type BudgetInput = {
  id: string;
  name: string;
  currency: string;
  period_start: string;
  period_end: string;
};

export type ActualsInput = {
  allocations: {
    allocationType: AllocationType;
    targetMinor: number;
    actualMinor: number;
    remainingMinor: number;
    percentConsumed: number | null;
    projectedMinor: number | null;
    status: AllocationStatus;
  }[];
  actualIncomeMinor: number;
  unmappedMinor: number;
  unmappedCount: number;
  uncategorizedMinor: number;
  uncategorizedCount: number;
  elapsedFraction: number | null;
  alerts: BudgetAlert[];
};

/**
 * Null when the budget is in a currency the apps cannot format; the route
 * leaves such a budget out rather than showing amounts with the wrong unit.
 */
export function toMobileBudget(
  budget: BudgetInput,
  actuals: ActualsInput,
): MobileBudget | null {
  if (!isSupportedCurrency(budget.currency)) return null;
  const currency = budget.currency;

  return {
    id: budget.id,
    name: budget.name,
    currency,
    periodStart: budget.period_start,
    periodEnd: budget.period_end,
    elapsedFraction: actuals.elapsedFraction,
    actualIncomeMinor: actuals.actualIncomeMinor,
    allocations: actuals.allocations.map((a) => ({
      type: a.allocationType,
      label: ALLOCATION_LABELS[a.allocationType],
      targetMinor: a.targetMinor,
      actualMinor: a.actualMinor,
      remainingMinor: a.remainingMinor,
      percentConsumed: a.percentConsumed,
      projectedMinor: a.projectedMinor,
      status: a.status,
    })),
    alerts: actuals.alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      message: budgetAlertMessage(alert, currency),
    })),
    uncategorizedCount: actuals.uncategorizedCount,
    uncategorizedMinor: actuals.uncategorizedMinor,
    unmappedCount: actuals.unmappedCount,
    unmappedMinor: actuals.unmappedMinor,
  };
}
