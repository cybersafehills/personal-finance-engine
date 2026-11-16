// Database row -> InsightFact, plus the small presentation helpers the
// Insights pages share. PURE: no I/O.
//
// The mapper is the one place that decides whether a stored transaction is
// fit to be counted. Anything it cannot count honestly is EXCLUDED and
// tallied, so the page can say "N transactions are not included" instead of
// quietly treating an unknown as zero.

import {
  compare,
  type Comparison,
  type CurrencyOverview,
  type InsightFact,
} from "./insights-math.ts";

export type InsightRow = {
  id: string;
  direction: "in" | "out" | "neutral";
  transaction_type: string;
  currency: string;
  amount_rwf: number | string | null;
  fee_rwf: number | string | null;
  principal_effect_rwf: number | string | null;
  fee_effect_rwf: number | string | null;
  category: string | null;
  counterparty_id?: string | null;
  counterparty_name: string | null;
  financial_source_id: string | null;
  settlement_state: string | null;
  occurred_at: string;
};

export type ExcludedCounts = {
  /** settlement_state is null or 'unknown' - we do not know if it happened. */
  unknownSettlement: number;
  /** Reversed by the provider - the money movement was undone. */
  reversed: number;
  /** Settled, but the accounting engine has not computed its effect yet. */
  uncomputed: number;
};

export function emptyExcluded(): ExcludedCounts {
  return { unknownSettlement: 0, reversed: 0, uncomputed: 0 };
}
export function excludedTotal(e: ExcludedCounts): number {
  return e.unknownSettlement + e.reversed + e.uncomputed;
}

/** null/undefined/"" are NOT zero: Number(null) === 0 would hide a gap. */
function int(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

export type MappedRow =
  | { fact: InsightFact }
  | { excluded: keyof ExcludedCounts };

export function toInsightFact(row: InsightRow): MappedRow {
  const state = row.settlement_state;
  if (state === "reversed") return { excluded: "reversed" };
  if (state !== "settled" && state !== "pending" && state !== "failed") {
    return { excluded: "unknownSettlement" };
  }

  let principal = int(row.principal_effect_rwf);
  let fee = int(row.fee_effect_rwf);
  if (principal === null || fee === null) {
    if (state === "settled") return { excluded: "uncomputed" };
    // Pending/failed rows are never part of a total; they are only counted
    // (failed) or shown as an "awaiting" amount (pending). The engine may not
    // have run on them, so fall back to the stated amount and fee.
    const amount = int(row.amount_rwf);
    const statedFee = int(row.fee_rwf) ?? 0;
    if (amount === null) return { excluded: "uncomputed" };
    principal = row.direction === "in"
      ? amount
      : row.direction === "out"
      ? -amount
      : 0;
    fee = -Math.abs(statedFee);
  }

  const occurred = new Date(row.occurred_at);
  if (Number.isNaN(occurred.getTime())) return { excluded: "uncomputed" };

  return {
    fact: {
      id: row.id,
      direction: row.direction,
      principalEffectRwf: principal,
      feeEffectRwf: fee,
      category: row.category,
      transactionType: row.transaction_type,
      counterpartyId: row.counterparty_id ?? null,
      counterpartyName: row.counterparty_name,
      // The "wallet" dimension is the financial source - the same key the
      // Transactions filter uses (transactions.account_id is not reliably set).
      accountId: row.financial_source_id,
      currency: row.currency,
      settlement: state,
      // The calc core compares instants as strings, so every instant must be
      // in ONE canonical form. PostgREST returns "...+00:00"; scope bounds are
      // "...Z" - mixing them mis-orders rows exactly on a period boundary.
      occurredAt: occurred.toISOString(),
    },
  };
}

export function toInsightFacts(
  rows: readonly InsightRow[],
): { facts: InsightFact[]; excluded: ExcludedCounts } {
  const facts: InsightFact[] = [];
  const excluded = emptyExcluded();
  for (const row of rows) {
    const m = toInsightFact(row);
    if ("fact" in m) facts.push(m.fact);
    else excluded[m.excluded]++;
  }
  return { facts, excluded };
}

// ----------------------------- presentation -------------------------------

const grouping = new Intl.NumberFormat("en-RW", {
  style: "decimal",
  maximumFractionDigits: 0,
});

/**
 * "12,345 RWF" / "−12,345 RWF". Amounts are whole units of `currency` (the
 * ledger stores no minor units today), formatted from the bigint directly -
 * never through a float.
 */
export function formatMoney(
  amount: bigint,
  currency: string,
  opts: { signed?: boolean } = {},
): string {
  const negative = amount < 0n;
  const magnitude = grouping.format(negative ? -amount : amount);
  const sign = negative ? "−" : opts.signed && amount > 0n ? "+" : "";
  return `${sign}${magnitude} ${currency}`;
}

/** Basis points -> "76.5%" (truncated, one decimal; never rounds up to 100). */
export function formatBps(bps: number): string {
  const sign = bps < 0 ? "−" : "";
  const a = Math.abs(bps);
  return `${sign}${Math.trunc(a / 100)}.${Math.trunc((a % 100) / 10)}%`;
}

export type HistoryCoverage = "none" | "partial" | "full";

/**
 * How much of the comparison window the ledger actually covers. With no
 * transaction before the current period there is nothing to compare with -
 * the comparison must be absent, not "up from 0".
 */
export function historyCoverage(
  earliestTxnAt: string | null,
  prevFrom: string,
  from: string,
): HistoryCoverage {
  if (!earliestTxnAt) return "none";
  const e = new Date(earliestTxnAt).toISOString();
  if (e >= from) return "none";
  return e > prevFrom ? "partial" : "full";
}

export type OverviewComparison = {
  moneyIn: Comparison;
  moneyOut: Comparison;
  net: Comparison;
};

export function compareOverviews(
  current: CurrencyOverview,
  previous: CurrencyOverview | undefined,
  coverage: HistoryCoverage,
): OverviewComparison {
  const prev = (pick: (o: CurrencyOverview) => bigint): bigint | null =>
    coverage === "none" ? null : previous ? pick(previous) : 0n;
  return {
    moneyIn: compare(current.moneyInMinor, prev((o) => o.moneyInMinor)),
    moneyOut: compare(current.moneyOutMinor, prev((o) => o.moneyOutMinor)),
    net: compare(current.netMinor, prev((o) => o.netMinor)),
  };
}

/**
 * Money that moved on rows with no wallet attached. byAccount only lists
 * rows that have one, so without this the wallet table would not add up to
 * the headline totals.
 */
export function unassignedAccountRemainder(
  o: CurrencyOverview,
): { moneyInMinor: bigint; moneyOutMinor: bigint } {
  let i = 0n, out = 0n;
  for (const a of o.byAccount) {
    i += a.moneyInMinor;
    out += a.moneyOutMinor;
  }
  return {
    moneyInMinor: o.moneyInMinor - i,
    moneyOutMinor: o.moneyOutMinor - out,
  };
}
