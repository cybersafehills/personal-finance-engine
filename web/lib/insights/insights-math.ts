// OneLedger 3.0 Insights calculation core (docs/oneledger-3/architecture.md,
// invariants I1-I6). PURE: no I/O, no framework imports. It COMPOSES the
// canonical report-math.ts conventions (settled facts carrying accounting-
// engine principal/fee effects) rather than re-deriving accounting - master
// prompt §64 "no parallel financial logic". What it adds: transfer
// exclusion, pending/failed separation, refund + cash-out handling,
// per-currency blocks, drill-down filters, bucketed trends, comparisons.
//
// Money is bigint minor units (RWF scale 0). Percentages are integer basis
// points. No floating point touches an amount.

import type { ReportDirection } from "../report-math.ts";

export type SettlementState = "settled" | "pending" | "failed";

export type InsightFact = {
  id: string;
  direction: ReportDirection;
  /** Signed effects from the accounting engine (legacy number RWF). */
  principalEffectRwf: number;
  feeEffectRwf: number;
  category: string | null;
  transactionType: string; // transactions.transaction_type
  counterpartyId?: string | null;
  counterpartyName: string | null;
  accountId: string | null;
  currency: string;
  settlement: SettlementState;
  occurredAt: string; // ISO-8601 instant
};

export type InsightScope = {
  /** Inclusive start, exclusive end (ISO instants, computed by report-period). */
  from: string;
  to: string;
  accountIds?: string[];
  category?: string; // "Uncategorized" matches null/blank
  counterpartyKey?: string;
};

export type TxClass =
  | "income"
  | "spend"
  | "cash_out"
  | "refund"
  | "transfer"
  | "pending"
  | "failed"
  | "neutral";

export const UNCATEGORIZED = "Uncategorized";
export const FEES_CATEGORY = "Fees";
export const CASH_OUT_CATEGORY = "Cash out";

function minor(n: number): bigint {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`insights: non-integer money value ${n}`);
  }
  return BigInt(n);
}
const abs = (v: bigint): bigint => (v < 0n ? -v : v);

export function counterpartyKey(f: InsightFact): string | null {
  if (f.counterpartyId) return `id:${f.counterpartyId}`;
  const n = f.counterpartyName?.trim().toLowerCase();
  return n ? `name:${n}` : null;
}

/** The single classification used by BOTH aggregation and drill-down (I5). */
export function classify(
  f: InsightFact,
  linkedTransferIds: ReadonlySet<string>,
): TxClass {
  if (f.settlement === "failed") return "failed";
  if (f.settlement === "pending") return "pending";
  if (linkedTransferIds.has(f.id)) return "transfer";
  if (f.direction === "neutral") return "neutral";
  if (f.direction === "in") {
    return f.transactionType === "refund" || f.transactionType === "reversal"
      ? "refund"
      : "income";
  }
  return f.transactionType === "cash_withdrawal" ? "cash_out" : "spend";
}

function inScope(f: InsightFact, s: InsightScope, currency: string): boolean {
  if (f.currency !== currency) return false;
  if (f.occurredAt < s.from || f.occurredAt >= s.to) return false;
  if (
    s.accountIds?.length && !(f.accountId && s.accountIds.includes(f.accountId))
  ) {
    return false;
  }
  if (s.category !== undefined) {
    const c = f.category?.trim() || UNCATEGORIZED;
    if (c !== s.category) return false;
  }
  if (
    s.counterpartyKey !== undefined && counterpartyKey(f) !== s.counterpartyKey
  ) {
    return false;
  }
  return true;
}

function effect(f: InsightFact): bigint {
  return minor(f.principalEffectRwf) + minor(f.feeEffectRwf);
}

export type DrilldownFilter = {
  scope: InsightScope;
  currency: string;
  kind:
    | "money_in"
    | "money_out"
    | "category"
    | "counterparty_sent"
    | "counterparty_received"
    | "account"
    | "transfers"
    | "pending"
    | "cash_out"
    | "refunds";
  value?: string; // category name / counterparty key / account id
};

/** Reproduces exactly the rows behind an aggregate (invariant I5). */
export function applyDrilldown(
  facts: readonly InsightFact[],
  filter: DrilldownFilter,
  linked: ReadonlySet<string>,
): InsightFact[] {
  return facts.filter((f) => {
    if (!inScope(f, filter.scope, filter.currency)) return false;
    const c = classify(f, linked);
    switch (filter.kind) {
      case "money_in":
        return c === "income";
      case "money_out":
        return c === "spend" || c === "cash_out" || c === "refund" ||
          (c === "income" && f.feeEffectRwf !== 0);
      case "category": {
        const cat = f.category?.trim() || UNCATEGORIZED;
        if (filter.value === FEES_CATEGORY) {
          return c === "income" && f.feeEffectRwf !== 0;
        }
        if (filter.value === CASH_OUT_CATEGORY) return c === "cash_out";
        return (c === "spend" || c === "refund") && cat === filter.value;
      }
      case "counterparty_sent":
        return (c === "spend" || c === "cash_out") &&
          counterpartyKey(f) === filter.value;
      case "counterparty_received":
        return c === "income" && counterpartyKey(f) === filter.value;
      case "account":
        return f.accountId === filter.value &&
          (c === "income" || c === "spend" || c === "cash_out" ||
            c === "refund");
      case "transfers":
        return c === "transfer";
      case "pending":
        return c === "pending";
      case "cash_out":
        return c === "cash_out";
      case "refunds":
        return c === "refund";
    }
  });
}

export type CategoryInsight = {
  category: string;
  amountMinor: bigint;
  count: number;
  /** Basis points of money_out; 0 when money_out is 0. */
  percentBps: number;
  drilldown: DrilldownFilter;
};
export type CounterpartyInsight = {
  key: string;
  displayName: string;
  sentMinor: bigint;
  receivedMinor: bigint;
  netMinor: bigint;
  count: number;
  drilldownSent: DrilldownFilter;
  drilldownReceived: DrilldownFilter;
};
export type AccountInsight = {
  accountId: string;
  moneyInMinor: bigint;
  moneyOutMinor: bigint;
  netMinor: bigint;
};
export type CurrencyOverview = {
  currency: string;
  moneyInMinor: bigint; // external income (excl. refunds, transfers)
  moneyOutMinor: bigint; // spend + cash-out + inbound fees, net of refunds
  netMinor: bigint; // === moneyIn - moneyOut (I1)
  refundsMinor: bigint;
  cashOutMinor: bigint;
  consumptionOutMinor: bigint; // moneyOut - cashOut
  countIn: number;
  countOut: number;
  transfersExcluded: { amountMinor: bigint; count: number };
  pending: { amountMinor: bigint; count: number };
  failedCount: number;
  byCategory: CategoryInsight[];
  byAccount: AccountInsight[];
  counterparties: CounterpartyInsight[];
  drilldowns: Record<
    "money_in" | "money_out" | "transfers" | "pending" | "cash_out" | "refunds",
    DrilldownFilter
  >;
};
export type InsightsOverview = {
  scope: InsightScope;
  currencies: CurrencyOverview[];
  freshness: { latestTxnAt: string | null };
};

function bps(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10000n) / whole); // integer division; result is small
}

export function computeOverview(
  facts: readonly InsightFact[],
  scope: InsightScope,
  linked: ReadonlySet<string>,
): InsightsOverview {
  const currencies = [...new Set(facts.map((f) => f.currency))].sort();
  let latest: string | null = null;
  for (const f of facts) {
    if (!latest || f.occurredAt > latest) latest = f.occurredAt;
  }
  return {
    scope,
    currencies: currencies.map((c) => computeCurrency(facts, scope, c, linked))
      .filter((o) =>
        o.countIn + o.countOut + o.transfersExcluded.count + o.pending.count +
            o.failedCount > 0
      ),
    freshness: { latestTxnAt: latest },
  };
}

function computeCurrency(
  facts: readonly InsightFact[],
  scope: InsightScope,
  currency: string,
  linked: ReadonlySet<string>,
): CurrencyOverview {
  let moneyIn = 0n, spend = 0n, cashOut = 0n, inboundFees = 0n, refunds = 0n;
  let countIn = 0, countOut = 0, failedCount = 0;
  let trAmt = 0n, trCount = 0, pdAmt = 0n, pdCount = 0;
  const cat = new Map<string, { amt: bigint; n: number }>();
  const acct = new Map<string, { i: bigint; o: bigint }>();
  const cp = new Map<string, {
    name: string;
    sent: bigint;
    recv: bigint;
    n: number;
  }>();
  const bump = <K>(m: Map<K, { amt: bigint; n: number }>, k: K, v: bigint) => {
    const e = m.get(k) ?? { amt: 0n, n: 0 };
    m.set(k, { amt: e.amt + v, n: e.n + 1 });
  };
  const acc = (id: string | null, i: bigint, o: bigint) => {
    if (!id) return;
    const e = acct.get(id) ?? { i: 0n, o: 0n };
    acct.set(id, { i: e.i + i, o: e.o + o });
  };
  const cpBump = (f: InsightFact, sent: bigint, recv: bigint) => {
    const k = counterpartyKey(f);
    if (!k) return;
    const e = cp.get(k) ??
      { name: f.counterpartyName?.trim() || k, sent: 0n, recv: 0n, n: 0 };
    cp.set(k, {
      name: e.name,
      sent: e.sent + sent,
      recv: e.recv + recv,
      n: e.n + 1,
    });
  };

  for (const f of facts) {
    if (!inScope(f, scope, currency)) continue;
    const c = classify(f, linked);
    const total = abs(effect(f));
    const label = f.category?.trim() || UNCATEGORIZED;
    switch (c) {
      case "failed":
        failedCount++;
        break;
      case "pending":
        pdAmt += total;
        pdCount++;
        break;
      case "transfer":
        trAmt += f.direction === "out" ? total : 0n;
        trCount++;
        break;
      case "neutral":
        break;
      case "income": {
        const p = minor(f.principalEffectRwf);
        const fee = abs(minor(f.feeEffectRwf));
        moneyIn += p;
        countIn++;
        acc(f.accountId, p, fee);
        cpBump(f, 0n, p);
        if (fee > 0n) {
          inboundFees += fee;
          bump(cat, FEES_CATEGORY, fee);
        }
        break;
      }
      case "spend":
        spend += total;
        countOut++;
        bump(cat, label, total);
        acc(f.accountId, 0n, total);
        cpBump(f, total, 0n);
        break;
      case "cash_out":
        cashOut += total;
        countOut++;
        bump(cat, CASH_OUT_CATEGORY, total);
        acc(f.accountId, 0n, total);
        cpBump(f, total, 0n);
        break;
      case "refund": {
        const r = effect(f);
        refunds += r;
        // Reduces the refunded category's spend; never counted as income (I3).
        const e = cat.get(label) ?? { amt: 0n, n: 0 };
        cat.set(label, { amt: e.amt - r, n: e.n });
        acc(f.accountId, 0n, -r);
        break;
      }
    }
  }

  const moneyOut = spend + cashOut + inboundFees - refunds;
  const net = moneyIn - moneyOut;

  const byCategory: CategoryInsight[] = [...cat.entries()]
    .map(([category, v]) => ({
      category,
      amountMinor: v.amt,
      count: v.n,
      percentBps: bps(v.amt, moneyOut),
      drilldown: {
        scope,
        currency,
        kind: "category",
        value: category,
      } as DrilldownFilter,
    }))
    .sort((a, b) =>
      a.amountMinor === b.amountMinor
        ? a.category.localeCompare(b.category)
        : a.amountMinor > b.amountMinor
        ? -1
        : 1
    );

  const dd = (kind: DrilldownFilter["kind"]): DrilldownFilter => ({
    scope,
    currency,
    kind,
  });

  return {
    currency,
    moneyInMinor: moneyIn,
    moneyOutMinor: moneyOut,
    netMinor: net,
    refundsMinor: refunds,
    cashOutMinor: cashOut,
    consumptionOutMinor: moneyOut - cashOut,
    countIn,
    countOut,
    transfersExcluded: { amountMinor: trAmt, count: trCount },
    pending: { amountMinor: pdAmt, count: pdCount },
    failedCount,
    byCategory,
    byAccount: [...acct.entries()].map(([accountId, v]) => ({
      accountId,
      moneyInMinor: v.i,
      moneyOutMinor: v.o,
      netMinor: v.i - v.o,
    })).sort((a, b) => a.accountId.localeCompare(b.accountId)),
    counterparties: [...cp.entries()].map(([key, v]) => ({
      key,
      displayName: v.name,
      sentMinor: v.sent,
      receivedMinor: v.recv,
      netMinor: v.recv - v.sent,
      count: v.n,
      drilldownSent: {
        scope,
        currency,
        kind: "counterparty_sent",
        value: key,
      } as DrilldownFilter,
      drilldownReceived: {
        scope,
        currency,
        kind: "counterparty_received",
        value: key,
      } as DrilldownFilter,
    })).sort((a, b) => {
      const av = a.sentMinor + a.receivedMinor,
        bv = b.sentMinor + b.receivedMinor;
      return av === bv ? a.key.localeCompare(b.key) : av > bv ? -1 : 1;
    }),
    drilldowns: {
      money_in: dd("money_in"),
      money_out: dd("money_out"),
      transfers: dd("transfers"),
      pending: dd("pending"),
      cash_out: dd("cash_out"),
      refunds: dd("refunds"),
    },
  };
}

// --------------------------- comparison ----------------------------------

export type Comparison = {
  currentMinor: bigint;
  previousMinor: bigint | null; // null = no history, never a fabricated 0
  deltaMinor: bigint | null;
  /** Basis points vs previous; null when previous is null or 0. */
  deltaBps: number | null;
};

export function compare(current: bigint, previous: bigint | null): Comparison {
  if (previous === null) {
    return {
      currentMinor: current,
      previousMinor: null,
      deltaMinor: null,
      deltaBps: null,
    };
  }
  const delta = current - previous;
  return {
    currentMinor: current,
    previousMinor: previous,
    deltaMinor: delta,
    deltaBps: previous === 0n ? null : Number((delta * 10000n) / abs(previous)),
  };
}

// ----------------------------- trends ------------------------------------

export type Granularity = "day" | "week" | "month";
export type TrendBucket = {
  bucketStart: string; // local calendar date YYYY-MM-DD in the given tz
  moneyInMinor: bigint;
  moneyOutMinor: bigint;
  netMinor: bigint;
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function localDate(iso: string, tz: string): string {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f.format(new Date(iso)); // YYYY-MM-DD
}

function bucketKey(date: string, g: Granularity): string {
  if (g === "day") return date;
  if (g === "month") return `${date.slice(0, 7)}-01`;
  // ISO week start (Monday) via UTC calendar arithmetic on the local date.
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function computeTrend(
  facts: readonly InsightFact[],
  scope: InsightScope,
  currency: string,
  linked: ReadonlySet<string>,
  granularity: Granularity,
  tz: string,
): TrendBucket[] {
  const m = new Map<string, { i: bigint; o: bigint }>();
  for (const f of facts) {
    if (!inScope(f, scope, currency)) continue;
    const c = classify(f, linked);
    let i = 0n, o = 0n;
    if (c === "income") {
      i = minor(f.principalEffectRwf);
      o = abs(minor(f.feeEffectRwf));
    } else if (c === "spend" || c === "cash_out") o = abs(effect(f));
    else if (c === "refund") o = -effect(f);
    else continue;
    const k = bucketKey(localDate(f.occurredAt, tz), granularity);
    const e = m.get(k) ?? { i: 0n, o: 0n };
    m.set(k, { i: e.i + i, o: e.o + o });
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(
    ([bucketStart, v]) => ({
      bucketStart,
      moneyInMinor: v.i,
      moneyOutMinor: v.o,
      netMinor: v.i - v.o,
    }),
  );
}
