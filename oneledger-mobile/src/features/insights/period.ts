import { kigaliDateKey, kigaliDayBoundsUtc } from "@/lib/kigali-time";

// Periods are whole Africa/Kigali calendar days. `to` is EXCLUSIVE (the start
// of the next day/month), matching the API: a transaction at 23:59 on the last
// day is in, one at 00:00 the next day is out.

export type PeriodId = "this_month" | "last_month" | "last_30_days";
export type Period = { id: PeriodId; label: string; from: string; to: string };

const startOfDay = (key: string) => kigaliDayBoundsUtc(key).startUtc;

function monthKey(year: number, month1: number): string {
  // normalises month overflow/underflow (0 -> Dec of previous year, 13 -> Jan next)
  const d = new Date(Date.UTC(year, month1 - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function insightPeriods(now: Date): Period[] {
  const today = kigaliDateKey(now.toISOString());
  const [y, m] = today.split("-").map(Number);

  const thisFrom = startOfDay(monthKey(y, m));
  const nextFrom = startOfDay(monthKey(y, m + 1));
  const lastFrom = startOfDay(monthKey(y, m - 1));

  // Rwanda has no daylight saving, so a day is always exactly 24 hours.
  const todayStart = startOfDay(today);
  const endOfToday = new Date(todayStart.getTime() + 24 * 3600 * 1000);
  const thirtyFrom = new Date(todayStart.getTime() - 29 * 24 * 3600 * 1000);

  return [
    { id: "this_month", label: "This month", from: thisFrom.toISOString(), to: nextFrom.toISOString() },
    { id: "last_month", label: "Last month", from: lastFrom.toISOString(), to: thisFrom.toISOString() },
    { id: "last_30_days", label: "Last 30 days", from: thirtyFrom.toISOString(), to: endOfToday.toISOString() },
  ];
}
