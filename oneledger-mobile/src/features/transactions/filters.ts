import { kigaliDateKey, kigaliDayBoundsUtc } from "@/lib/kigali-time";

// Ledger filters for the Transactions tab. Pure: the screen holds the choice,
// these turn it into query bounds and a human summary. Periods are Kigali
// calendar days, like every other date in the app.

export type DirectionFilter = "all" | "in" | "out";
export type PeriodFilter = "all" | "7d" | "30d" | "month";

export type TransactionFilters = {
  direction: DirectionFilter;
  period: PeriodFilter;
  needsReview: boolean;
};

export const NO_FILTERS: TransactionFilters = { direction: "all", period: "all", needsReview: false };

export const DIRECTION_OPTIONS: { value: DirectionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in", label: "Money in" },
  { value: "out", label: "Money out" },
];

export const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
];

/** How many filters differ from the defaults (for the "Clear" affordance). */
export function activeFilterCount(f: TransactionFilters): number {
  return (f.direction !== "all" ? 1 : 0) + (f.period !== "all" ? 1 : 0) + (f.needsReview ? 1 : 0);
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Inclusive UTC lower bound of a period, or null for all time. "Last 7 days"
 * means today plus the six days before it, in Kigali time.
 */
export function periodStartUtc(period: PeriodFilter, nowIso: string): string | null {
  if (period === "all") return null;
  const today = kigaliDateKey(nowIso);
  const startKey =
    period === "7d" ? addDays(today, -6) : period === "30d" ? addDays(today, -29) : `${today.slice(0, 8)}01`;
  return kigaliDayBoundsUtc(startKey).startUtc.toISOString();
}
