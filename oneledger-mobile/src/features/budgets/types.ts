// Mirrors web/lib/mobile-budgets.ts (the /api/mobile/budgets payload). The
// figures are computed on the server by the web's canonical budget maths; the
// app only displays them. Amounts are integer minor units of `currency`.

import type { SupportedCurrency } from "@/lib/money";

export type AllocationStatus =
  | "healthy"
  | "watch"
  | "at_risk"
  | "exceeded"
  | "insufficient_data";

export type BudgetAllocation = {
  type: string;
  label: string;
  targetMinor: number;
  actualMinor: number;
  remainingMinor: number;
  percentConsumed: number | null;
  projectedMinor: number | null;
  status: AllocationStatus;
};

export type BudgetAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type Budget = {
  id: string;
  name: string;
  currency: SupportedCurrency;
  periodStart: string;
  periodEnd: string;
  elapsedFraction: number | null;
  actualIncomeMinor: number;
  allocations: BudgetAllocation[];
  alerts: BudgetAlert[];
  uncategorizedCount: number;
  uncategorizedMinor: number;
  unmappedCount: number;
  unmappedMinor: number;
};
