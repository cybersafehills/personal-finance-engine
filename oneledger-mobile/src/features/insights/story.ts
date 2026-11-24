import { formatMoney } from "@/lib/money";
import { kigaliDateKey } from "@/lib/kigali-time";

import type { ForecastPoint, WalletForecast } from "./forecast";
import type { Baseline, RecurringPayment, UnusualPayment } from "./intelligence";

// Plain-words storytelling for the Insights card and the outlook page. Everything here is
// pure and deterministic: the same numbers always give the same sentence, and every
// sentence says only what the numbers support. Written to be read by anyone from a
// teenager to a grandparent: short sentences, no jargon ("counterparty", "baseline",
// "scheduled"), money always as a plain positive amount with a word saying which way it went.

const rwf = (value: bigint) => formatMoney(value < 0n ? -value : value, "RWF");
const signed = (value: bigint) => (value < 0n ? `−${rwf(value)}` : value > 0n ? `+${rwf(value)}` : rwf(0n));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// When does the money run out?
// ---------------------------------------------------------------------------

type Shape = { days: number; netExpected: number; netCautious: number; checkpoints: { day: number; scheduled: number }[] };

/** The forecast's own numbers, reduced to what is needed to walk the balance day by day. */
export function shapeOf(wallet: WalletForecast): Shape {
  const last = wallet.points[wallet.points.length - 1];
  const days = Math.max(1, last?.day ?? 1);
  return {
    days,
    netExpected: Number(wallet.estimatedEnd - wallet.scheduledEnd) / days,
    netCautious: Number(wallet.noIncomeEnd - wallet.scheduledEnd) / days,
    checkpoints: wallet.points.map((p) => ({ day: p.day, scheduled: Number(p.scheduled) })),
  };
}

/**
 * The first day the balance goes below zero, or null if it never does. Between dated items the
 * balance falls in a straight line, and at each dated item it jumps; both are checked, so the
 * answer is the day the money really runs out, not the day of the lowest point.
 */
export function firstDayBelowZero(shape: Shape, netPerDay: number): number | null {
  const { checkpoints } = shape;
  for (let i = 0; i < checkpoints.length; i++) {
    const { day, scheduled } = checkpoints[i];
    if (scheduled + netPerDay * day < 0) return day; // below zero as soon as this dated item lands
    const nextDay = i + 1 < checkpoints.length ? checkpoints[i + 1].day : day;
    if (netPerDay < 0 && nextDay > day) {
      const hitsZeroAt = -scheduled / netPerDay;
      if (hitsZeroAt < nextDay) return hitsZeroAt;
    }
  }
  return null;
}

/** "26 Nov" for `offsetDays` after `fromIso`, on the Kigali calendar. */
export function dayLabel(fromIso: string, offsetDays: number): string {
  const [y, m, d] = kigaliDateKey(fromIso).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + Math.max(0, Math.round(offsetDays))));
  return `${date.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]}`;
}

// ---------------------------------------------------------------------------
// The one-sentence verdict
// ---------------------------------------------------------------------------

export type OutlookTone = "good" | "watch" | "alert";
export type Outlook = {
  tone: OutlookTone;
  title: string;
  message: string;
  /** Whole days until the money runs out at the usual pace, or null. */
  runsOutInDays: number | null;
  /** Same, if no new money arrives. */
  cautiousRunsOutInDays: number | null;
};

const wholeDays = (d: number) => Math.max(0, Math.ceil(d));
const aboutDays = (n: number) => (n <= 0 ? "right away" : `in about ${plural(n, "day", "days")}`);

export function outlookFor(wallet: WalletForecast, days: number, hidden: boolean, nowIso: string): Outlook {
  const shape = shapeOf(wallet);
  const expected = firstDayBelowZero(shape, shape.netExpected);
  const cautious = wallet.estimatesIncome ? firstDayBelowZero(shape, shape.netCautious) : expected;
  const expectedDays = expected === null ? null : wholeDays(expected);
  const cautiousDays = cautious === null ? null : wholeDays(cautious);
  const asOf = wallet.balanceAsOf ? ` (last recorded ${dayLabel(wallet.balanceAsOf, 0)})` : "";

  if (expectedDays !== null) {
    const title = expectedDays <= 0 ? "Your balance is already below zero" : `Your money may run out ${aboutDays(expectedDays)}`;
    const message = hidden
      ? "At your recent pace, the money in this wallet could be used up soon. Money that arrives sooner would stretch it."
      : `At your recent pace, the ${rwf(wallet.opening)} in ${wallet.name}${asOf} could be used up around ${dayLabel(nowIso, expectedDays)}. Money that arrives sooner would stretch it.`;
    return { tone: "alert", title, message, runsOutInDays: expectedDays, cautiousRunsOutInDays: cautiousDays };
  }
  if (cautiousDays !== null) {
    const message = hidden
      ? "If your usual income arrives you should be fine, but if nothing new comes in the money could run out."
      : `If your usual income arrives, you would still have about ${rwf(wallet.estimatedEnd)} after ${days} days. If nothing new comes in, it could run out ${aboutDays(cautiousDays)}.`;
    return { tone: "watch", title: "Fine if your usual income arrives", message, runsOutInDays: null, cautiousRunsOutInDays: cautiousDays };
  }
  const message = hidden
    ? `At your recent pace, you should have money left after ${days} days.`
    : `At your recent pace, you would still have about ${rwf(wallet.estimatedEnd)} after ${days} days${wallet.estimatesIncome ? ` (about ${rwf(wallet.noIncomeEnd)} if nothing new comes in)` : ""}.`;
  return { tone: "good", title: "You're on track", message, runsOutInDays: null, cautiousRunsOutInDays: null };
}

// ---------------------------------------------------------------------------
// "How do we get from today's balance to that number?"
// ---------------------------------------------------------------------------

export type WalkRow = { key: "start" | "bills" | "spending" | "income" | "end"; label: string; hint: string; amount: bigint; text: string };

export function walkRows(wallet: WalletForecast, days: number, hidden: boolean): WalkRow[] {
  const billsAndRepeats = wallet.scheduledEnd - wallet.opening;
  const everyday = wallet.noIncomeEnd - wallet.scheduledEnd;
  const income = wallet.estimatedEnd - wallet.noIncomeEnd;
  const money = (v: bigint, signedValue: boolean) => (hidden ? "Hidden" : signedValue ? signed(v) : rwf(v));
  const rows: WalkRow[] = [
    { key: "start", label: "What you have now", hint: wallet.balanceAsOf ? `Recorded ${dayLabel(wallet.balanceAsOf, 0)}` : "Your last recorded balance", amount: wallet.opening, text: money(wallet.opening, false) },
    { key: "bills", label: "Bills and repeating payments", hint: billsAndRepeats === 0n ? "None found coming up" : "Payments with a regular date", amount: billsAndRepeats, text: billsAndRepeats === 0n ? money(0n, false) : money(billsAndRepeats, true) },
    { key: "spending", label: "Everyday spending", hint: "An estimate from your last 3 months", amount: everyday, text: money(everyday, true) },
  ];
  if (wallet.estimatesIncome) rows.push({ key: "income", label: "Money coming in", hint: "An estimate of your usual income", amount: income, text: money(income, true) });
  rows.push({ key: "end", label: `Left after ${days} days`, hint: wallet.estimatesIncome ? "If everything goes as usual" : "At your recent pace", amount: wallet.estimatedEnd, text: money(wallet.estimatedEnd, false) });
  return rows;
}

// ---------------------------------------------------------------------------
// The chart's two lines, with the real jumps on dated payments
// ---------------------------------------------------------------------------

export type OutlookPoint = { day: number; expected: number; cautious: number };

/** Expected (usual income) and cautious (no new money) balances; each dated payment is a drop, not a slope. */
export function outlookSeries(wallet: WalletForecast): OutlookPoint[] {
  const shape = shapeOf(wallet);
  const out: OutlookPoint[] = [];
  shape.checkpoints.forEach((cp, i) => {
    if (i > 0) {
      const before = shape.checkpoints[i - 1].scheduled;
      out.push({ day: cp.day, expected: before + shape.netExpected * cp.day, cautious: before + shape.netCautious * cp.day });
    }
    out.push({ day: cp.day, expected: cp.scheduled + shape.netExpected * cp.day, cautious: cp.scheduled + shape.netCautious * cp.day });
  });
  return out;
}

// ---------------------------------------------------------------------------
// The three fact sections, in plain words
// ---------------------------------------------------------------------------

export type PaceStory = { tone: "good" | "watch" | "neutral"; title: string; sentence: string; spent: bigint; usual: bigint; fraction: number };

export function paceStory(b: Baseline, hidden: boolean): PaceStory {
  const pct = Math.abs(b.changePercent);
  const title = b.direction === "in_line" ? "About the same as usual" : b.direction === "below" ? `${pct}% less than usual` : `${pct}% more than usual`;
  const sentence = hidden
    ? `So far this month you have spent ${b.direction === "in_line" ? "about the same as" : b.direction === "below" ? "less than" : "more than"} you usually have by this point.`
    : `You have spent ${rwf(b.thisMonth)} so far this month. By this point you usually have spent ${rwf(b.usual)}.`;
  const fraction = b.usual > 0n ? Number((b.thisMonth * 1000n) / b.usual) / 1000 : 0;
  return { tone: b.direction === "above" ? "watch" : b.direction === "below" ? "good" : "neutral", title, sentence, spent: b.thisMonth, usual: b.usual, fraction };
}

export const largePaymentsTitle = (n: number) => (n === 1 ? "1 payment much bigger than usual" : `${n} payments much bigger than usual`);
export function largePaymentLine(a: UnusualPayment, hidden: boolean): { who: string; detail: string } {
  const times = Number.isInteger(a.timesTypical) ? String(a.timesTypical) : a.timesTypical.toFixed(1);
  return { who: a.counterparty, detail: hidden ? `About ${times} times what you usually pay them` : `${rwf(a.amount)}, about ${times} times your usual ${rwf(a.typical)}` };
}

export const repeatingTitle = (n: number) => (n === 1 ? "1 payment that repeats every month" : `${n} payments that repeat every month`);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
export function repeatingLine(p: RecurringPayment, hidden: boolean): { who: string; detail: string } {
  const when = `usually around the ${ordinal(p.typicalDay)}, seen in ${p.monthsSeen} of the last 4 months`;
  return { who: p.counterparty, detail: hidden ? `${p.category ? `${p.category} · ` : ""}${when}` : `About ${rwf(p.typicalAmount)}${p.category ? ` · ${p.category}` : ""} · ${when}` };
}
export const repeatingMonthlyTotal = (items: readonly RecurringPayment[]) => items.reduce((sum, p) => sum + p.typicalAmount, 0n);
export const formatPlain = rwf;

// ---------------------------------------------------------------------------
// Home summary rows and small phrases shared by Home and the outlook page
// ---------------------------------------------------------------------------

/** What is left (or missing) at the end, said as a plain sentence instead of a signed number. */
export function endLine(wallet: WalletForecast, days: number, hidden: boolean): string {
  if (hidden) return `Your balance after ${days} days is hidden.`;
  const end = wallet.estimatedEnd;
  return end < 0n ? `Short by about ${rwf(end)} after ${days} days` : `About ${rwf(end)} left after ${days} days`;
}

/** A dated payment: which way the money moves, in words. */
export function commitmentLine(delta: bigint, hidden: boolean): string {
  if (hidden) return delta === 0n ? "No change" : delta < 0n ? "Pays out" : "Comes in";
  return delta < 0n ? `Pays out ${rwf(delta)}` : delta > 0n ? `Comes in ${rwf(delta)}` : "No change";
}

export type SummaryRow = { key: "outlook" | "pace" | "large" | "repeat"; icon: "calendar" | "bar-chart-2" | "alert-circle" | "repeat"; title: string; detail: string };

type SummarySource = { baseline: Baseline | null; anomalies: readonly UnusualPayment[]; anomaliesTotal: number; recurring: readonly RecurringPayment[]; recurringTotal: number };

/** At most four one-line rows for Home, however much activity there is: the full page holds the detail. */
export function summaryRows(source: SummarySource | null, wallet: WalletForecast | null, days: number, hidden: boolean): SummaryRow[] {
  const rows: SummaryRow[] = [];
  if (wallet) rows.push({ key: "outlook", icon: "calendar", title: `The next ${days} days`, detail: endLine(wallet, days, hidden) });
  if (source?.baseline) rows.push({ key: "pace", icon: "bar-chart-2", title: "Spending this month", detail: paceStory(source.baseline, hidden).title });
  if (source && source.anomaliesTotal > 0) {
    rows.push({ key: "large", icon: "alert-circle", title: largePaymentsTitle(source.anomaliesTotal), detail: source.anomalies[0] ? `Including ${source.anomalies[0].counterparty}` : "Worth a look" });
  }
  if (source && source.recurringTotal > 0) {
    const monthly = repeatingMonthlyTotal(source.recurring);
    rows.push({ key: "repeat", icon: "repeat", title: repeatingTitle(source.recurringTotal), detail: hidden || source.recurring.length < source.recurringTotal ? "See them all" : `About ${rwf(monthly)} a month in total` });
  }
  return rows;
}

export type ScheduledItem = { day: number; label: string; delta: bigint; balance: bigint };

/** Dated payments: every point after today, with its change from the one before. */
export function scheduledItems(f: WalletForecast): ScheduledItem[] {
  const items: ScheduledItem[] = [];
  let previous: bigint = f.opening;
  for (const point of f.points as ForecastPoint[]) {
    if (point.day <= 0) continue;
    items.push({ day: point.day, label: point.label, delta: point.scheduled - previous, balance: point.scheduled });
    previous = point.scheduled;
  }
  return items;
}
