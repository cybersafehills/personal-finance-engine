import { formatMoney, type SupportedCurrency } from "@/lib/money";

import type { Comparison } from "./types";

/** Basis points -> "76.5%" (one decimal, truncated: 7654 -> "76.5%"). */
export function formatBps(bps: number): string {
  const negative = bps < 0;
  const abs = Math.abs(Math.trunc(bps));
  return `${negative ? "−" : ""}${Math.floor(abs / 100)}.${Math.floor((abs % 100) / 10)}%`;
}

/** Fraction 0-1 for a bar from basis points. */
export function bpsFraction(bps: number): number {
  return Math.min(1, Math.max(0, bps / 10000));
}

/**
 * "Up 12.3% from the previous period" / "No earlier period to compare with".
 * `moreIsBad` flips the tone words for spending ("Up" is the same text either
 * way; only the caller's colour choice differs).
 */
export function compareText(c: Comparison, currency: SupportedCurrency): string {
  if (c.previousMinor === null || c.deltaMinor === null) {
    return "No earlier period to compare with";
  }
  const dir = c.deltaMinor === BigInt(0) ? "Same as" : c.deltaMinor > BigInt(0) ? "Up from" : "Down from";
  if (c.deltaMinor === BigInt(0)) return "Same as the previous period";
  const pct = c.deltaBps === null ? "" : ` (${formatBps(Math.abs(c.deltaBps))})`;
  const amount = formatMoney(c.deltaMinor < BigInt(0) ? -c.deltaMinor : c.deltaMinor, currency);
  return `${dir} the previous period by ${amount}${pct}`;
}

export function netTone(net: bigint): "positive" | "attention" | "neutral" {
  return net > BigInt(0) ? "positive" : net < BigInt(0) ? "attention" : "neutral";
}

/** A one-line, screen-reader friendly description of a category row. */
export function categorySummary(category: string, amount: bigint, bps: number, count: number, currency: SupportedCurrency): string {
  return `${category}: ${formatMoney(amount, currency)}, ${formatBps(bps)} of money out, ${count} ${count === 1 ? "transaction" : "transactions"}`;
}

export const DRILLDOWN_TITLES: Record<string, string> = {
  money_in: "Money in",
  money_out: "Money out",
  transfers: "Transfers between your wallets",
  pending: "Pending",
  cash_out: "Cash withdrawals",
  refunds: "Refunds",
  account: "Wallet activity",
  counterparty_sent: "Sent",
  counterparty_received: "Received",
};
