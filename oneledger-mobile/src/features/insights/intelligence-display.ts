import { formatMoney } from "@/lib/money";

import type { Baseline, RecurringPayment, UnusualPayment } from "./intelligence";
import type { ForecastPoint, WalletForecast } from "./forecast";

// Plain-words wording for the insight blocks. Same sentences as the web card,
// so a figure reads the same on both. Spending is shown as money out (negative).

const rwf = (minorUnits: bigint) => formatMoney(minorUnits, "RWF");
const outflow = (minorUnits: bigint) => rwf(-(minorUnits < 0n ? -minorUnits : minorUnits));

/** "−RWF 120,000 so far, 50% above your recent pace (usually −RWF 80,000 by now)." */
export function baselineSentence(b: Baseline, hidden: boolean): string {
  const pace = b.direction === "in_line" ? "about the same as" : `${Math.abs(b.changePercent)}% ${b.direction}`;
  if (hidden) return `Spending so far this month is ${pace} your recent pace.`;
  return `${outflow(b.thisMonth)} so far, ${pace} your recent pace (usually ${outflow(b.usual)} by now).`;
}

export function unusualHeading(count: number): string {
  return count === 1 ? "An unusually large payment" : `${count} unusually large payments`;
}

export function unusualLine(a: UnusualPayment, hidden: boolean): string {
  const times = Number.isInteger(a.timesTypical) ? String(a.timesTypical) : a.timesTypical.toFixed(1);
  return hidden
    ? `${a.counterparty}: about ${times}× the usual`
    : `${a.counterparty} · ${outflow(a.amount)} · about ${times}× your usual ${outflow(a.typical)}`;
}

export function recurringHeading(count: number): string {
  return `${count} recurring payment${count === 1 ? "" : "s"} detected`;
}

export function recurringLine(p: RecurringPayment, hidden: boolean): string {
  const base = `${p.counterparty}${p.category ? ` · ${p.category}` : ""}`;
  const timing = `around day ${p.typicalDay} · seen ${p.monthsSeen} months`;
  return hidden ? `${base} · ${timing}` : `${base} · ~${outflow(p.typicalAmount)} · ${timing}`;
}

/** The forecast sentence pair shown on Home: what the balance may be in N days. */
export function projectionLines(f: WalletForecast, days: number, hidden: boolean): { heading: string; detail: string } {
  const heading = `${f.name}: projected balance in ${days} days`;
  if (hidden) return { heading, detail: "Amounts are hidden." };
  const detail = f.estimatesIncome
    ? `If nothing new comes in: ${rwf(f.noIncomeEnd)} · with your usual income: ${rwf(f.estimatedEnd)}`
    : f.estimatedEnd !== f.scheduledEnd
      ? `Scheduled items only: ${rwf(f.scheduledEnd)} · with everyday spending: ${rwf(f.estimatedEnd)}`
      : `Scheduled items only: ${rwf(f.scheduledEnd)}`;
  return { heading, detail };
}

export type ScheduledItem = { day: number; label: string; delta: bigint; balance: bigint };

/** Dated commitments: every point after today, with its change from the one before (as the web table). */
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
