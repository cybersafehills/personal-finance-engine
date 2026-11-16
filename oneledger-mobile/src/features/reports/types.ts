import type { BudgetAllocation } from "@/features/budgets/types";

// The daily report payloads from GET /api/mobile/reports[/:id]. Every figure is
// from the report's stored snapshot and every sentence and date is rendered by
// the web's own functions (lib/mobile-reports.ts): the app only displays them.

export type ReportListItem = {
  id: string;
  dateLabel: string;
  status: string;
  statusLabel: string;
  generatedLabel: string | null;
};

export type ReportTone = "positive" | "negative" | "neutral";

export type ReportTrend = {
  label: string;
  valueLabel: string;
  changePercent: number | null;
  tone: ReportTone;
};

export type ReportAlert = { id: string; tone: "attention" | "neutral"; message: string };

export type ReportCategory = {
  category: string;
  amountRwf: number;
  transactionCount: number;
  percentOfSpending: number;
};

export type ReportSnapshot = {
  closingBalanceRwf: number | null;
  netMovementRwf: number;
  moneyReceivedRwf: number;
  moneySpentRwf: number;
  feesRwf: number;
  transactionCount: number;
  largestOutflowRwf: number | null;
  largestInflowRwf: number | null;
};

export type Report = {
  id: string;
  status: string;
  statusLabel: string;
  dateLabel: string;
  timezone: string;
  generatedLabel: string | null;
  errorMessage: string | null;
  hasDocument: boolean;
  snapshot: ReportSnapshot | null;
  categories: ReportCategory[];
  /** null = no active RWF budget for this period. */
  budget: { allocations: BudgetAllocation[] } | null;
  trends: ReportTrend[];
  alerts: ReportAlert[];
  forecast: { projectedMonthEndSpendRwf: number; disclaimer: string } | null;
  insights: { summary: string; observations: string[] } | null;
};
