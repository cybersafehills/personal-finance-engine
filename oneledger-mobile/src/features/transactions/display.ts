import { dateGroupLabel } from "@/lib/kigali-time";

import type { TransactionRow } from "./queries";

// Presentation rules for a transaction, ported from the web
// (lib/display-name.ts, components/TransactionItem.tsx,
// components/TransactionList.tsx). Never changes stored data.

/** Human-readable counterparty label. */
export function displayName(
  transaction: Pick<TransactionRow, "counterparty_name" | "transaction_type">,
): string {
  const raw = transaction.counterparty_name;
  if (!raw) {
    return transaction.transaction_type === "airtime" ? "MTN Airtime" : "Unknown";
  }
  // MTN's airtime SMS sometimes renders the counterparty as "Airtime with
  // token and ET Id: ..."; show one consistent label instead.
  if (transaction.transaction_type === "airtime" || raw.startsWith("Airtime with token")) {
    return "MTN Airtime";
  }
  return raw;
}

export function isFailed(transaction: Pick<TransactionRow, "status">): boolean {
  return transaction.status !== "success";
}

const REVIEW_STATUSES = ["provisional", "suggested", "conflict"];

export function needsReview(
  transaction: Pick<TransactionRow, "category_decision_status">,
): boolean {
  return REVIEW_STATUSES.includes(transaction.category_decision_status);
}

/** Signed amount for display: + in, − out, 0 for neutral or failed. */
export function signedAmountRwf(
  transaction: Pick<TransactionRow, "direction" | "amount_rwf" | "status">,
): number {
  if (isFailed(transaction)) return 0;
  if (transaction.direction === "in") return transaction.amount_rwf;
  if (transaction.direction === "out") return -transaction.amount_rwf;
  return 0;
}

const TYPE_LABELS: Record<string, string> = {
  airtime: "Airtime",
  merchant_payment: "Payment to a business",
  transfer_out: "Money sent",
  transfer_in: "Money received",
  cash_out: "Cash withdrawal",
  cash_in: "Cash deposit",
  bill_payment: "Bill payment",
  bank_transfer: "Bank transfer",
};

/** "merchant_payment" -> "Payment to a business"; unknown types are tidied. */
export function transactionTypeLabel(type: string): string {
  if (TYPE_LABELS[type]) return TYPE_LABELS[type];
  const words = type.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Transaction";
}

export type TransactionSection<T> = { title: string; data: T[] };

/** Groups newest-first rows into Today / Yesterday / "August 18" sections. */
export function groupByDay<T extends Pick<TransactionRow, "occurred_at">>(
  transactions: T[],
  nowIso: string,
): TransactionSection<T>[] {
  const sections: TransactionSection<T>[] = [];
  for (const transaction of transactions) {
    const title = dateGroupLabel(transaction.occurred_at, nowIso);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(transaction);
    else sections.push({ title, data: [transaction] });
  }
  return sections;
}

type BalanceRow = {
  balance_after_rwf: number;
  occurred_at: string;
  direction: string;
  principal_effect_rwf: number | null;
};

/**
 * The newest internally-consistent balance snapshot. MTN occasionally sends
 * a "received" SMS whose Balance: line hasn't caught up with the credit it
 * reports; a wallet can't go negative, so receiving money can never leave
 * the balance below the amount just credited. Such a row is skipped.
 * (Same rule as web getCurrentBalance, PR #173.)
 */
export function pickPlausibleBalance(
  rows: BalanceRow[],
): { amountRwf: number; asOfIso: string } | null {
  const plausible = rows.find(
    (row) =>
      row.direction !== "in" ||
      row.principal_effect_rwf === null ||
      row.balance_after_rwf >= row.principal_effect_rwf,
  );
  return plausible
    ? { amountRwf: plausible.balance_after_rwf, asOfIso: plausible.occurred_at }
    : null;
}

/** Today's settled money in / out (principal + fees), as positive numbers. */
export function sumTodayTotals(
  rows: { direction: string; principal_effect_rwf: number | null; fee_effect_rwf: number | null }[],
): { spentRwf: number; receivedRwf: number } {
  let spentRwf = 0;
  let receivedRwf = 0;
  for (const row of rows) {
    const effect = Number(row.principal_effect_rwf ?? 0) + Number(row.fee_effect_rwf ?? 0);
    if (row.direction === "out") spentRwf += Math.abs(effect);
    else if (row.direction === "in") receivedRwf += effect;
  }
  return { spentRwf, receivedRwf };
}

/** Escapes what a user might type that PostgREST's `or` filter treats as syntax. */
export function safeSearchTerm(q: string): string {
  return q.trim().replace(/[%,()]/g, " ").trim();
}
