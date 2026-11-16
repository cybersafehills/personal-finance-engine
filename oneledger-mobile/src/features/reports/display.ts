import type { ReportTone } from "./types";

/** "+20%", "−5%", "0%" (a real minus sign, and no sign at all for zero). */
export function signedPercent(percent: number): string {
  const rounded = Math.round(percent);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

/** Spending/fees up read as unfavourable (amber), income up as favourable (green), counts stay plain. */
export function toneColor(tone: ReportTone): "moneyPositive" | "attention" | "textMuted" {
  return tone === "positive" ? "moneyPositive" : tone === "negative" ? "attention" : "textMuted";
}

/** A tone is also spelled out, so colour is never the only signal. */
export function toneWord(tone: ReportTone, changePercent: number | null): string {
  if (changePercent === null || changePercent === 0 || tone === "neutral") return "";
  const rising = changePercent > 0;
  return tone === "positive" ? (rising ? "up, good" : "down, good") : rising ? "up, worth a look" : "down, worth a look";
}

/** Bar fill 0-1 from a 0-100 share, with the web's 2% floor so a small category never reads as empty. */
export function shareFraction(percentOfSpending: number): number {
  if (!(percentOfSpending > 0)) return 0;
  return Math.min(1, Math.max(percentOfSpending / 100, 0.02));
}

export const countLabel = (count: number): string =>
  `${count} ${count === 1 ? "transaction" : "transactions"}`;

/** Two-up rows for the activity tiles. */
export function inRows<T>(items: readonly T[], size = 2): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
