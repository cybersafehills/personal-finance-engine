// Pure request parsing + JSON serialisation for the Insights mobile API
// (docs/oneledger-3/contracts.md). No I/O, no framework imports. bigint amounts
// leave as decimal STRINGS (JSON has no bigint and Number loses precision).

import type {
  AccountInsight,
  CategoryInsight,
  Comparison,
  CounterpartyInsight,
  CurrencyOverview,
  DrilldownFilter,
  Granularity,
  InsightFact,
  InsightScope,
  InsightsOverview,
  TrendBucket,
} from "./insights-math.ts";

export const MAX_RANGE_DAYS = 400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export type OverviewParams = {
  scope: InsightScope;
  tz: string;
  workspaceId: string | null;
  granularity: Granularity | null;
  compare: boolean;
};

export type ParseError =
  | "invalid_range"
  | "range_too_large"
  | "invalid_account"
  | "invalid_workspace"
  | "invalid_timezone"
  | "invalid_granularity"
  | "invalid_filter";

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Whitelisted query parameters only; anything unexpected is ignored, never passed through. */
export function parseOverviewParams(
  q: URLSearchParams,
): { ok: true; value: OverviewParams } | { ok: false; error: ParseError } {
  const from = q.get("from"), to = q.get("to");
  if (!from || !to || !ISO.test(from) || !ISO.test(to)) {
    return { ok: false, error: "invalid_range" };
  }
  const f = Date.parse(from), t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t) || f >= t) {
    return { ok: false, error: "invalid_range" };
  }
  if ((t - f) / 86_400_000 > MAX_RANGE_DAYS) {
    return { ok: false, error: "range_too_large" };
  }

  const accountIds = q.getAll("account_id");
  if (accountIds.length > 50 || accountIds.some((a) => !UUID.test(a))) {
    return { ok: false, error: "invalid_account" };
  }
  const workspaceId = q.get("workspace_id");
  if (workspaceId !== null && !UUID.test(workspaceId)) {
    return { ok: false, error: "invalid_workspace" };
  }

  const tz = q.get("tz") ?? "Africa/Kigali";
  if (!validTimeZone(tz)) return { ok: false, error: "invalid_timezone" };

  const g = q.get("granularity");
  if (g !== null && g !== "day" && g !== "week" && g !== "month") {
    return { ok: false, error: "invalid_granularity" };
  }

  const category = q.get("category");
  const counterparty = q.get("counterparty");
  if (
    (category !== null && (category.length < 1 || category.length > 120)) ||
    (counterparty !== null &&
      (counterparty.length < 1 || counterparty.length > 200))
  ) {
    return { ok: false, error: "invalid_filter" };
  }

  const scope: InsightScope = {
    from: new Date(f).toISOString(),
    to: new Date(t).toISOString(),
  };
  if (accountIds.length) scope.accountIds = accountIds;
  if (category !== null) scope.category = category;
  if (counterparty !== null) scope.counterpartyKey = counterparty;

  return {
    ok: true,
    value: {
      scope,
      tz,
      workspaceId,
      granularity: g as Granularity | null,
      compare: q.get("compare") === "previous",
    },
  };
}

/** The equally long period immediately before `scope`. */
export function previousScope(scope: InsightScope): InsightScope {
  const f = Date.parse(scope.from), t = Date.parse(scope.to);
  return {
    ...scope,
    from: new Date(f - (t - f)).toISOString(),
    to: scope.from,
  };
}

// ------------------------------ serialisation ------------------------------

const s = (v: bigint): string => v.toString();

export function serializeDrilldown(d: DrilldownFilter) {
  return {
    kind: d.kind,
    value: d.value ?? null,
    currency: d.currency,
    from: d.scope.from,
    to: d.scope.to,
    account_ids: d.scope.accountIds ?? null,
  };
}

function serializeCategory(c: CategoryInsight) {
  return {
    category: c.category,
    amount_minor: s(c.amountMinor),
    count: c.count,
    percent_bps: c.percentBps,
    drilldown: serializeDrilldown(c.drilldown),
  };
}
function serializeAccount(a: AccountInsight) {
  return {
    account_id: a.accountId,
    money_in_minor: s(a.moneyInMinor),
    money_out_minor: s(a.moneyOutMinor),
    net_minor: s(a.netMinor),
  };
}
function serializeCounterparty(c: CounterpartyInsight) {
  return {
    key: c.key,
    display_name: c.displayName,
    sent_minor: s(c.sentMinor),
    received_minor: s(c.receivedMinor),
    net_minor: s(c.netMinor),
    count: c.count,
    drilldown_sent: serializeDrilldown(c.drilldownSent),
    drilldown_received: serializeDrilldown(c.drilldownReceived),
  };
}
export function serializeComparison(c: Comparison) {
  return {
    current_minor: s(c.currentMinor),
    previous_minor: c.previousMinor === null ? null : s(c.previousMinor),
    delta_minor: c.deltaMinor === null ? null : s(c.deltaMinor),
    delta_bps: c.deltaBps,
  };
}

export function serializeCurrency(
  o: CurrencyOverview,
  extra: { compare?: Record<string, Comparison>; trend?: TrendBucket[] } = {},
) {
  return {
    currency: o.currency,
    money_in_minor: s(o.moneyInMinor),
    money_out_minor: s(o.moneyOutMinor),
    net_minor: s(o.netMinor),
    refunds_minor: s(o.refundsMinor),
    cash_out_minor: s(o.cashOutMinor),
    consumption_out_minor: s(o.consumptionOutMinor),
    count_in: o.countIn,
    count_out: o.countOut,
    transfers_excluded: {
      amount_minor: s(o.transfersExcluded.amountMinor),
      count: o.transfersExcluded.count,
    },
    pending: { amount_minor: s(o.pending.amountMinor), count: o.pending.count },
    failed_count: o.failedCount,
    by_category: o.byCategory.map(serializeCategory),
    by_account: o.byAccount.map(serializeAccount),
    top_counterparties: o.counterparties.slice(0, 10).map(
      serializeCounterparty,
    ),
    drilldowns: Object.fromEntries(
      Object.entries(o.drilldowns).map(([k, v]) => [k, serializeDrilldown(v)]),
    ),
    compare: extra.compare
      ? Object.fromEntries(
        Object.entries(extra.compare).map((
          [k, v],
        ) => [k, serializeComparison(v)]),
      )
      : null,
    trend: extra.trend
      ? extra.trend.map((b) => ({
        bucket_start: b.bucketStart,
        money_in_minor: s(b.moneyInMinor),
        money_out_minor: s(b.moneyOutMinor),
        net_minor: s(b.netMinor),
      }))
      : null,
  };
}

export function serializeOverview(
  o: InsightsOverview,
  tz: string,
  extras: Record<
    string,
    { compare?: Record<string, Comparison>; trend?: TrendBucket[] }
  > = {},
) {
  return {
    period: { from: o.scope.from, to: o.scope.to, tz },
    currencies: o.currencies.map((c) =>
      serializeCurrency(c, extras[c.currency])
    ),
    freshness: { latest_txn_at: o.freshness.latestTxnAt },
  };
}

/** A drill-down row: only what the list needs (no raw SMS, no balances). */
export function serializeFact(f: InsightFact) {
  return {
    id: f.id,
    direction: f.direction,
    transaction_type: f.transactionType,
    amount_minor: s(BigInt(f.principalEffectRwf + f.feeEffectRwf)),
    currency: f.currency,
    category: f.category,
    counterparty_name: f.counterpartyName,
    account_id: f.accountId,
    status: f.settlement,
    occurred_at: f.occurredAt,
  };
}

// ----------------------------- drill-down params ---------------------------

const KINDS = [
  "money_in",
  "money_out",
  "category",
  "counterparty_sent",
  "counterparty_received",
  "account",
  "transfers",
  "pending",
  "cash_out",
  "refunds",
] as const;

export type DrilldownParams = {
  filter: DrilldownFilter;
  workspaceId: string | null;
  tz: string;
  limit: number;
  offset: number;
};

export function parseDrilldownParams(
  q: URLSearchParams,
):
  | { ok: true; value: DrilldownParams }
  | {
    ok: false;
    error: ParseError | "invalid_kind" | "invalid_currency" | "invalid_page";
  } {
  const base = parseOverviewParams(q);
  if (!base.ok) return base;
  const kind = q.get("kind");
  if (!kind || !(KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "invalid_kind" };
  }
  const currency = q.get("currency");
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "invalid_currency" };
  }
  const value = q.get("value");
  const needsValue = kind === "category" || kind.startsWith("counterparty_") ||
    kind === "account";
  if (needsValue && (!value || value.length > 200)) {
    return { ok: false, error: "invalid_filter" };
  }
  const limit = Number(q.get("limit") ?? 50),
    offset = Number(q.get("offset") ?? 0);
  if (
    !Number.isInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isInteger(offset) || offset < 0
  ) {
    return { ok: false, error: "invalid_page" };
  }
  const filter: DrilldownFilter = {
    scope: base.value.scope,
    currency,
    kind: kind as DrilldownFilter["kind"],
    ...(value ? { value } : {}),
  };
  return {
    ok: true,
    value: {
      filter,
      workspaceId: base.value.workspaceId,
      tz: base.value.tz,
      limit,
      offset,
    },
  };
}
