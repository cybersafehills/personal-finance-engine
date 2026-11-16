// URL <-> Insights query, and the period arithmetic behind it. PURE: no I/O.
// Everything a user (or a crafted link) can put in the query string is
// validated here; anything invalid falls back to a safe default instead of
// reaching a database query.
//
// Periods are calendar dates in the viewer's timezone. `fromKey`/`toKey` are
// both INCLUSIVE (what a person means by "1 Nov to 30 Nov"); the resolved
// window is [from, to) in UTC instants, where `to` is local midnight after
// `toKey` - so the whole last day is included and DST days keep their real
// length (report-period.localMidnightUtc).

import { localMidnightUtc, shiftDateKey } from "../report-period.ts";
import type {
  DrilldownFilter,
  Granularity,
  InsightScope,
} from "./insights-math.ts";

export type PeriodPreset =
  | "this_month"
  | "last_month"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_year"
  | "custom";

export const PERIOD_PRESETS: readonly { value: PeriodPreset; label: string }[] =
  [
    { value: "this_month", label: "This month" },
    { value: "last_month", label: "Last month" },
    { value: "last_7_days", label: "Last 7 days" },
    { value: "last_30_days", label: "Last 30 days" },
    { value: "last_90_days", label: "Last 90 days" },
    { value: "this_year", label: "This year" },
    { value: "custom", label: "Custom dates" },
  ];

/** Longest period one page load will aggregate (plus an equal comparison window). */
export const MAX_PERIOD_DAYS = 366;

export type InsightsQuery = {
  preset: PeriodPreset;
  /** Inclusive local calendar dates, YYYY-MM-DD. */
  fromKey: string;
  toKey: string;
  /** financial_sources.id values (the "wallet" dimension). */
  sourceIds: string[];
  category?: string;
  currency?: string;
  /** Undefined = chosen automatically from the period length. */
  granularity?: Granularity;
};

type RawParams = Record<string, string | string[] | undefined>;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_TEXT = 120;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = typeof s === "string" ? s.trim() : "";
  return t ? t : undefined;
}
function many(v: string | string[] | undefined): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return list.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
}

export function isValidDateKey(key: string): boolean {
  if (!DATE_KEY.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d;
}

/** Whole days from `a` to `b` (date keys), b - a. */
export function daysBetween(a: string, b: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

function presetRange(
  preset: Exclude<PeriodPreset, "custom">,
  todayKey: string,
): { fromKey: string; toKey: string } {
  const monthStart = `${todayKey.slice(0, 7)}-01`;
  switch (preset) {
    case "this_month":
      return { fromKey: monthStart, toKey: todayKey };
    case "last_month": {
      const lastDayPrev = shiftDateKey(monthStart, -1);
      return { fromKey: `${lastDayPrev.slice(0, 7)}-01`, toKey: lastDayPrev };
    }
    case "last_7_days":
      return { fromKey: shiftDateKey(todayKey, -6), toKey: todayKey };
    case "last_30_days":
      return { fromKey: shiftDateKey(todayKey, -29), toKey: todayKey };
    case "last_90_days":
      return { fromKey: shiftDateKey(todayKey, -89), toKey: todayKey };
    case "this_year":
      return { fromKey: `${todayKey.slice(0, 4)}-01-01`, toKey: todayKey };
  }
}

/**
 * `todayKey` is today's calendar date in the viewer's timezone. Invalid or
 * out-of-range input degrades to "this month"; it never throws.
 */
export function parseInsightsQuery(
  sp: RawParams,
  todayKey: string,
): InsightsQuery {
  const presetRaw = one(sp.period);
  const known = PERIOD_PRESETS.some((p) => p.value === presetRaw);
  let preset: PeriodPreset = known ? (presetRaw as PeriodPreset) : "this_month";

  let range = preset === "custom"
    ? null
    : presetRange(preset as Exclude<PeriodPreset, "custom">, todayKey);
  if (!range) {
    const from = one(sp.from);
    const to = one(sp.to);
    const ok = !!from && !!to && isValidDateKey(from) && isValidDateKey(to) &&
      from <= to && daysBetween(from, to) < MAX_PERIOD_DAYS;
    if (ok) range = { fromKey: from!, toKey: to! };
    else {
      preset = "this_month";
      range = presetRange("this_month", todayKey);
    }
  }

  const sourceIds = [...new Set(many(sp.account).filter((s) => UUID.test(s)))]
    .slice(0, 25);
  const category = one(sp.category)?.slice(0, MAX_TEXT);
  const cur = one(sp.currency)?.toUpperCase();
  const g = one(sp.granularity);

  return {
    preset,
    fromKey: range.fromKey,
    toKey: range.toKey,
    sourceIds,
    category,
    currency: cur && CURRENCY.test(cur) ? cur : undefined,
    granularity: g === "day" || g === "week" || g === "month" ? g : undefined,
  };
}

export type InsightsWindow = {
  /** [from, to) as ISO instants. */
  from: string;
  to: string;
  /** The equal-length window immediately before it: [prevFrom, from). */
  prevFrom: string;
  prevFromKey: string;
  prevToKey: string;
  days: number;
};

export function resolveWindow(q: InsightsQuery, tz: string): InsightsWindow {
  const days = daysBetween(q.fromKey, q.toKey) + 1;
  const prevFromKey = shiftDateKey(q.fromKey, -days);
  return {
    from: localMidnightUtc(q.fromKey, tz).toISOString(),
    to: localMidnightUtc(shiftDateKey(q.toKey, 1), tz).toISOString(),
    prevFrom: localMidnightUtc(prevFromKey, tz).toISOString(),
    prevFromKey,
    prevToKey: shiftDateKey(q.fromKey, -1),
    days,
  };
}

export function autoGranularity(days: number): Granularity {
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

export function scopeFor(
  q: InsightsQuery,
  from: string,
  to: string,
): InsightScope {
  return {
    from,
    to,
    ...(q.sourceIds.length ? { accountIds: q.sourceIds } : {}),
    ...(q.category !== undefined ? { category: q.category } : {}),
  };
}

/** Query string that reproduces `q` (no leading "?"). */
export function insightsQueryString(
  q: InsightsQuery,
  overrides: Partial<InsightsQuery> = {},
): string {
  const m = { ...q, ...overrides };
  const p = new URLSearchParams();
  p.set("period", m.preset);
  if (m.preset === "custom") {
    p.set("from", m.fromKey);
    p.set("to", m.toKey);
  }
  for (const id of m.sourceIds) p.append("account", id);
  if (m.category !== undefined) p.set("category", m.category);
  if (m.currency) p.set("currency", m.currency);
  if (m.granularity) p.set("granularity", m.granularity);
  return p.toString();
}

// ------------------------------ drill-down --------------------------------

export const DRILLDOWN_KINDS: readonly DrilldownFilter["kind"][] = [
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
];
const KINDS_WITH_VALUE = new Set<DrilldownFilter["kind"]>([
  "category",
  "counterparty_sent",
  "counterparty_received",
  "account",
]);

/**
 * Link to the rows behind one aggregate. The period and filters come from
 * the page query (always pinned to explicit dates so the link means the
 * same thing tomorrow); kind/value/currency come from the aggregate.
 */
export function drilldownHref(q: InsightsQuery, f: DrilldownFilter): string {
  const p = new URLSearchParams(
    insightsQueryString(q, { preset: "custom", granularity: undefined }),
  );
  // The aggregate's own scope wins over the page filters it was built from.
  p.delete("category");
  if (f.scope.category !== undefined) p.set("category", f.scope.category);
  p.set("kind", f.kind);
  // "cur" (the figure's currency) is separate from "currency" (the page's
  // optional filter), so "Back to Insights" never adds a filter the user
  // did not choose.
  p.set("cur", f.currency);
  if (f.value !== undefined) p.set("value", f.value);
  return `/insights/transactions?${p.toString()}`;
}

export type DrilldownRequest = {
  kind: DrilldownFilter["kind"];
  value?: string;
  currency: string;
};

/** Null when the link is malformed - the page then shows "not found". */
export function parseDrilldown(sp: RawParams): DrilldownRequest | null {
  const kind = one(sp.kind) as DrilldownFilter["kind"] | undefined;
  if (!kind || !DRILLDOWN_KINDS.includes(kind)) return null;
  const currency = one(sp.cur)?.toUpperCase();
  if (!currency || !CURRENCY.test(currency)) return null;
  const value = one(sp.value)?.slice(0, 200);
  if (KINDS_WITH_VALUE.has(kind) && value === undefined) return null;
  return {
    kind,
    currency,
    ...(KINDS_WITH_VALUE.has(kind) ? { value } : {}),
  };
}

export function drilldownTitle(
  d: DrilldownRequest,
  label?: string,
): string {
  switch (d.kind) {
    case "money_in":
      return "Money in";
    case "money_out":
      return "Money out";
    case "category":
      return `Category: ${d.value}`;
    case "counterparty_sent":
      return `Sent to ${label ?? "this contact"}`;
    case "counterparty_received":
      return `Received from ${label ?? "this contact"}`;
    case "account":
      return `Wallet: ${label ?? "selected wallet"}`;
    case "transfers":
      return "Transfers between your own wallets";
    case "pending":
      return "Pending transactions";
    case "cash_out":
      return "Cash withdrawals";
    case "refunds":
      return "Refunds and reversals";
  }
}
