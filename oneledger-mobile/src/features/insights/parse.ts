import { failureForStatus, type BearerFailure } from "@/api/bearer";
import type { SupportedCurrency } from "@/lib/money";

import type {
  CategoryRow,
  Comparison,
  CurrencyOverview,
  Drilldown,
  DrilldownKind,
  DrilldownTransaction,
  InsightsOverview,
  PersonRow,
} from "./types";

const KINDS: readonly DrilldownKind[] = [
  "money_in", "money_out", "category", "counterparty_sent", "counterparty_received",
  "account", "transfers", "pending", "cash_out", "refunds",
];
const CURRENCIES: readonly SupportedCurrency[] = ["RWF", "EUR", "USD"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/** Decimal-string minor units -> bigint, or null when it isn't a plain integer. */
export function minor(v: unknown): bigint | null {
  return typeof v === "string" && /^-?\d{1,19}$/.test(v) ? BigInt(v) : null;
}

function drilldown(raw: unknown): Drilldown | null {
  if (!isRecord(raw)) return null;
  if (!KINDS.includes(raw.kind as DrilldownKind)) return null;
  if (!str(raw.currency) || !str(raw.from) || !str(raw.to)) return null;
  const ids = Array.isArray(raw.account_ids) ? raw.account_ids.filter(str) : null;
  return {
    kind: raw.kind as DrilldownKind,
    value: typeof raw.value === "string" ? raw.value : null,
    currency: raw.currency,
    from: raw.from,
    to: raw.to,
    accountIds: ids && ids.length > 0 ? ids : null,
  };
}

function comparison(raw: unknown): Comparison | null {
  if (!isRecord(raw)) return null;
  const current = minor(raw.current_minor);
  if (current === null) return null;
  const prev = raw.previous_minor === null ? null : minor(raw.previous_minor);
  const delta = raw.delta_minor === null ? null : minor(raw.delta_minor);
  const bps = typeof raw.delta_bps === "number" && Number.isFinite(raw.delta_bps) ? raw.delta_bps : null;
  return { currentMinor: current, previousMinor: prev, deltaMinor: delta, deltaBps: bps };
}

function category(raw: unknown): CategoryRow | null {
  if (!isRecord(raw) || !str(raw.category)) return null;
  const amount = minor(raw.amount_minor);
  const n = count(raw.count);
  const dd = drilldown(raw.drilldown);
  if (amount === null || n === null || !dd) return null;
  const bps = typeof raw.percent_bps === "number" && Number.isFinite(raw.percent_bps) ? raw.percent_bps : 0;
  return { category: raw.category, amountMinor: amount, count: n, percentBps: bps, drilldown: dd };
}

function person(raw: unknown): PersonRow | null {
  if (!isRecord(raw) || !str(raw.key) || !str(raw.display_name)) return null;
  const sent = minor(raw.sent_minor), recv = minor(raw.received_minor), n = count(raw.count);
  if (sent === null || recv === null || n === null) return null;
  return { key: raw.key, displayName: raw.display_name, sentMinor: sent, receivedMinor: recv, count: n };
}

function currencyOverview(raw: unknown): CurrencyOverview | "skip" | null {
  if (!isRecord(raw)) return null;
  if (!CURRENCIES.includes(raw.currency as SupportedCurrency)) return "skip";
  const inM = minor(raw.money_in_minor), outM = minor(raw.money_out_minor), net = minor(raw.net_minor);
  const cash = minor(raw.cash_out_minor);
  const cIn = count(raw.count_in), cOut = count(raw.count_out);
  if (inM === null || outM === null || net === null || cash === null || cIn === null || cOut === null) return null;

  const tr = isRecord(raw.transfers_excluded) ? raw.transfers_excluded : null;
  const pd = isRecord(raw.pending) ? raw.pending : null;
  const trAmt = tr ? minor(tr.amount_minor) : null, trN = tr ? count(tr.count) : null;
  const pdAmt = pd ? minor(pd.amount_minor) : null, pdN = pd ? count(pd.count) : null;
  if (trAmt === null || trN === null || pdAmt === null || pdN === null) return null;

  const dds = isRecord(raw.drilldowns) ? raw.drilldowns : null;
  const dIn = dds && drilldown(dds.money_in), dOut = dds && drilldown(dds.money_out);
  const dTr = dds && drilldown(dds.transfers), dPd = dds && drilldown(dds.pending);
  if (!dIn || !dOut || !dTr || !dPd) return null;

  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  let compare: CurrencyOverview["compare"] = null;
  if (isRecord(raw.compare)) {
    const a = comparison(raw.compare.money_in), b = comparison(raw.compare.money_out), c = comparison(raw.compare.net);
    if (a && b && c) compare = { moneyIn: a, moneyOut: b, net: c };
  }

  return {
    currency: raw.currency as SupportedCurrency,
    moneyInMinor: inM,
    moneyOutMinor: outM,
    netMinor: net,
    cashOutMinor: cash,
    countIn: cIn,
    countOut: cOut,
    transfersExcluded: { amountMinor: trAmt, count: trN },
    pending: { amountMinor: pdAmt, count: pdN },
    byCategory: list(raw.by_category).map(category).filter((c): c is CategoryRow => c !== null),
    topPeople: list(raw.top_counterparties).map(person).filter((p): p is PersonRow => p !== null),
    compare,
    drilldowns: { moneyIn: dIn, moneyOut: dOut, transfers: dTr, pending: dPd },
  };
}

export type InsightsResult =
  | { ok: true; workspaceId: string; overview: InsightsOverview }
  | ({ ok: false } & BearerFailure);

const TOO_BIG: BearerFailure = {
  reason: "error",
  message: "That period has too many transactions to summarise. Try a shorter period.",
};

export function parseInsightsResponse(status: number, body: unknown): InsightsResult {
  if (status === 422) return { ok: false, ...TOO_BIG };
  if (status !== 200 || !isRecord(body) || body.ok !== true) {
    return { ok: false, ...failureForStatus(status, "Insights") };
  }
  const ov = isRecord(body.overview) ? body.overview : null;
  const period = ov && isRecord(ov.period) ? ov.period : null;
  if (!ov || !period || !str(period.from) || !str(period.to) || !str(body.workspace_id) || !Array.isArray(ov.currencies)) {
    return { ok: false, ...failureForStatus(500, "Insights") };
  }
  const currencies: CurrencyOverview[] = [];
  let skipped = 0;
  for (const raw of ov.currencies) {
    const c = currencyOverview(raw);
    if (c === "skip") skipped += 1;
    else if (c) currencies.push(c);
    else return { ok: false, ...failureForStatus(500, "Insights") }; // a malformed currency block is never half-shown
  }
  const fresh = isRecord(ov.freshness) && typeof ov.freshness.latest_txn_at === "string" ? ov.freshness.latest_txn_at : null;
  return {
    ok: true,
    workspaceId: body.workspace_id,
    overview: { from: period.from, to: period.to, latestTxnAt: fresh, currencies, skippedCurrencies: skipped },
  };
}

// ------------------------------ drill-down ------------------------------

export type DrilldownResult =
  | { ok: true; total: number; transactions: DrilldownTransaction[] }
  | ({ ok: false } & BearerFailure);

function tx(raw: unknown): DrilldownTransaction | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.occurred_at) || !str(raw.transaction_type) || !str(raw.status)) return null;
  if (raw.direction !== "in" && raw.direction !== "out" && raw.direction !== "neutral") return null;
  if (!CURRENCIES.includes(raw.currency as SupportedCurrency)) return null;
  const amount = minor(raw.amount_minor);
  if (amount === null) return null;
  return {
    id: raw.id,
    direction: raw.direction,
    transactionType: raw.transaction_type,
    amountMinor: amount,
    currency: raw.currency as SupportedCurrency,
    category: typeof raw.category === "string" ? raw.category : null,
    counterpartyName: typeof raw.counterparty_name === "string" ? raw.counterparty_name : null,
    status: raw.status,
    occurredAt: raw.occurred_at,
  };
}

export function parseDrilldownResponse(status: number, body: unknown): DrilldownResult {
  if (status === 422) return { ok: false, ...TOO_BIG };
  if (status !== 200 || !isRecord(body) || body.ok !== true || !Array.isArray(body.transactions)) {
    return { ok: false, ...failureForStatus(status, "These transactions") };
  }
  const total = count(body.total);
  if (total === null) return { ok: false, ...failureForStatus(500, "These transactions") };
  return {
    ok: true,
    total,
    transactions: body.transactions.map(tx).filter((t): t is DrilldownTransaction => t !== null),
  };
}
