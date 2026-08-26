// Shared, JSON-safe report data shapes - deliberately factored out of
// report-generation.ts (which needs "server-only" + @supabase/supabase-js
// and is therefore not resolvable by `deno test`'s own type-checker) so
// pure consumers of these shapes - the Reports UI, the email renderer,
// and their deno-testable helper modules (report-alert-messages.ts) -
// can reference them without pulling service-role/database code into
// their own type-check/test graph. Only type-level imports from
// budget-math.ts/report-math.ts, both already zero-import themselves, so
// this file stays fully deno-testable-graph-safe even though nothing here
// needs its own tests (no runtime logic, types only).
//
// report-generation.ts is still the ONLY place values of these types are
// ever constructed (bigint -> number conversion happens there, see its
// own comment) - this file only declares the shape.

import type { AllocationStatus, AllocationType } from "./budget-math.ts";
import type {
  CategoryTotal,
  FinancialSnapshot,
  Forecast,
  ReportAlert,
  TrendComparison,
} from "./report-math.ts";

export type AllocationActualJson = {
  allocationType: AllocationType;
  targetMinor: number;
  actualMinor: number;
  remainingMinor: number;
  percentConsumed: number | null;
  projectedMinor: number | null;
  status: AllocationStatus;
};

export type BudgetAlertJson =
  | {
    id: string;
    kind: "allocation_watch" | "allocation_at_risk";
    severity: "info" | "warning";
    allocationType: AllocationType;
    percentConsumed: number;
  }
  | {
    id: string;
    kind: "allocation_exceeded";
    severity: "critical";
    allocationType: AllocationType;
    actualMinor: number;
    targetMinor: number;
  }
  | {
    id: string;
    kind: "unmapped_spending" | "uncategorized_spending";
    severity: "warning";
    count: number;
    totalMinor: number;
  }
  | {
    id: string;
    kind: "income_below_budget";
    severity: "warning";
    budgetedMinor: number;
    actualMinor: number;
    shortfallPercent: number;
  };

export type BudgetSection = {
  budgetId: string;
  periodStart: string;
  periodEnd: string;
  overallStatus: AllocationStatus;
  allocations: AllocationActualJson[];
  alerts: BudgetAlertJson[];
} | { overallStatus: "no_active_budget" };

export type ReportPayload = {
  schemaVersion: number;
  dateKey: string;
  timezone: string;
  financialSnapshot: FinancialSnapshot;
  categoryTotals: CategoryTotal[];
  trends: TrendComparison[];
  alerts: ReportAlert[];
  budget: BudgetSection;
  forecast: Forecast | null;
};
