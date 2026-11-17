// Budget period logic that decides whether a budget is still "current", what
// the budget for today's month would be, and what to call it. PURE (no
// imports) so it is unit-tested with `deno test`.
//
// Why this exists: an "active" budget never expired. Home kept showing "On
// track, 194,280 of 500,000 used" and the Inbox "September Budget needs
// attention" two months after September ended, because nothing compared the
// period to today. All dates are calendar date keys ("YYYY-MM-DD", Kigali
// calendar), compared as strings, which is correct for that format.

export type PeriodState = "upcoming" | "current" | "ended";

export function budgetPeriodState(
  periodStart: string,
  periodEnd: string,
  todayKey: string,
): PeriodState {
  if (todayKey < periodStart) return "upcoming";
  if (todayKey > periodEnd) return "ended";
  return "current";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export type MonthPeriod = {
  periodStart: string; // first day of the month
  periodEnd: string; // last day of the month
  monthName: string; // "November"
  year: number;
};

/** The calendar month containing `todayKey`. */
export function monthPeriodFor(todayKey: string): MonthPeriod {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayKey);
  if (!m) throw new RangeError(`Invalid date key: ${todayKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new RangeError(`Invalid date key: ${todayKey}`);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    periodStart: `${year}-${mm}-01`,
    periodEnd: `${year}-${mm}-${String(last).padStart(2, "0")}`,
    monthName: MONTHS[month - 1],
    year,
  };
}

/**
 * Names the new budget for its month. A name that starts with a month
 * ("September Budget", "September 2026 plan") has that month replaced; any
 * other name ("Household") is kept as the owner wrote it.
 */
export function nameForMonth(sourceName: string, target: MonthPeriod): string {
  const m = new RegExp(`^(${MONTHS.join("|")})\\b(\\s+\\d{4})?(.*)$`).exec(sourceName.trim());
  if (!m) return sourceName;
  const hadYear = m[2] !== undefined;
  return `${target.monthName}${hadYear ? ` ${target.year}` : ""}${m[3]}`;
}
