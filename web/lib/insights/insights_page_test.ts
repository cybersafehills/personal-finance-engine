// Tests for the Insights page's pure layer: flag, URL/period parsing, the
// row -> fact mapper, and an end-to-end "rows in, page figures out" fixture
// that goes through the SAME functions the page calls.

import { assertEquals } from "jsr:@std/assert@1";
import { applyDrilldown, computeOverview } from "./insights-math.ts";
import {
  compareOverviews,
  formatBps,
  formatMoney,
  historyCoverage,
  type InsightRow,
  toInsightFact,
  toInsightFacts,
  unassignedAccountRemainder,
} from "./insights-facts.ts";
import { isInsightsCenterEnabledFor } from "./insights-flag.ts";
import {
  autoGranularity,
  drilldownHref,
  insightsQueryString,
  parseDrilldown,
  parseInsightsQuery,
  resolveWindow,
  scopeFor,
} from "./insights-params.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const SRC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SRC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

Deno.test("flag: off unless exactly 'true'; allowlist narrows", () => {
  assertEquals(isInsightsCenterEnabledFor({}, WS), false);
  assertEquals(
    isInsightsCenterEnabledFor({ INSIGHTS_CENTER_ENABLED: "1" }, WS),
    false,
  );
  assertEquals(
    isInsightsCenterEnabledFor({ INSIGHTS_CENTER_ENABLED: "true" }, WS),
    true,
  );
  const env = {
    INSIGHTS_CENTER_ENABLED: "true",
    INSIGHTS_CENTER_WORKSPACE_ALLOWLIST: ` other , ${WS} `,
  };
  assertEquals(isInsightsCenterEnabledFor(env, WS), true);
  assertEquals(isInsightsCenterEnabledFor(env, "someone-else"), false);
  assertEquals(isInsightsCenterEnabledFor(env, null), false);
});

Deno.test("params: presets resolve to inclusive local dates", () => {
  const today = "2026-11-16";
  assertEquals(parseInsightsQuery({}, today).fromKey, "2026-11-01");
  assertEquals(parseInsightsQuery({}, today).toKey, "2026-11-16");
  const last = parseInsightsQuery({ period: "last_month" }, today);
  assertEquals([last.fromKey, last.toKey], ["2026-10-01", "2026-10-31"]);
  const jan = parseInsightsQuery({ period: "last_month" }, "2026-01-05");
  assertEquals([jan.fromKey, jan.toKey], ["2025-12-01", "2025-12-31"]);
  const w = parseInsightsQuery({ period: "last_7_days" }, today);
  assertEquals([w.fromKey, w.toKey], ["2026-11-10", "2026-11-16"]);
  const y = parseInsightsQuery({ period: "this_year" }, today);
  assertEquals(y.fromKey, "2026-01-01");
});

Deno.test("params: hostile or invalid input degrades to safe defaults", () => {
  const today = "2026-11-16";
  const bad = [
    { period: "custom", from: "2026-13-40", to: "2026-11-02" },
    { period: "custom", from: "2026-11-10", to: "2026-11-01" }, // reversed
    { period: "custom", from: "2020-01-01", to: "2026-11-01" }, // > 1 year
    { period: "custom", from: "2026-02-30", to: "2026-03-01" }, // not a date
    { period: "custom" },
    { period: "'; drop table" },
  ];
  for (const sp of bad) {
    const q = parseInsightsQuery(sp, today);
    assertEquals([q.preset, q.fromKey, q.toKey], [
      "this_month",
      "2026-11-01",
      "2026-11-16",
    ]);
  }
  const q = parseInsightsQuery({
    account: [SRC_A, "not-a-uuid", `${SRC_B},${SRC_A}`],
    currency: "rwf",
    granularity: "hour",
    category: "  Food  ",
  }, today);
  assertEquals(q.sourceIds, [SRC_A, SRC_B]);
  assertEquals(q.currency, "RWF");
  assertEquals(q.granularity, undefined);
  assertEquals(q.category, "Food");
  assertEquals(
    parseInsightsQuery({ currency: "RWF1" }, today).currency,
    undefined,
  );
});

Deno.test("window: inclusive end date, equal-length comparison, Kigali", () => {
  const q = parseInsightsQuery({
    period: "custom",
    from: "2026-11-01",
    to: "2026-11-30",
  }, "2026-12-05");
  const w = resolveWindow(q, "Africa/Kigali");
  assertEquals(w.days, 30);
  assertEquals(w.from, "2026-10-31T22:00:00.000Z");
  assertEquals(w.to, "2026-11-30T22:00:00.000Z"); // midnight AFTER 30 Nov
  assertEquals(w.prevFrom, "2026-10-01T22:00:00.000Z");
  assertEquals([w.prevFromKey, w.prevToKey], ["2026-10-02", "2026-10-31"]);
});

Deno.test("window: a DST day keeps its real 23-hour length (New York)", () => {
  const q = parseInsightsQuery({
    period: "custom",
    from: "2026-03-08",
    to: "2026-03-08",
  }, "2026-03-20");
  const w = resolveWindow(q, "America/New_York");
  assertEquals(w.from, "2026-03-08T05:00:00.000Z");
  assertEquals(w.to, "2026-03-09T04:00:00.000Z");
});

Deno.test("params: query string round-trips; granularity defaults by length", () => {
  const today = "2026-11-16";
  const q = parseInsightsQuery({
    period: "custom",
    from: "2026-10-01",
    to: "2026-10-31",
    account: SRC_A,
    category: "Food & drink",
    currency: "RWF",
    granularity: "week",
  }, today);
  const sp = Object.fromEntries(new URLSearchParams(insightsQueryString(q)));
  assertEquals(parseInsightsQuery(sp, today), q);
  assertEquals(
    [autoGranularity(31), autoGranularity(32), autoGranularity(121)],
    ["day", "week", "month"],
  );
});

Deno.test("drill-down: links pin dates and parse back; malformed -> null", () => {
  const today = "2026-11-16";
  const q = parseInsightsQuery({ period: "this_month" }, today);
  const w = resolveWindow(q, "Africa/Kigali");
  const href = drilldownHref(q, {
    scope: scopeFor(q, w.from, w.to),
    currency: "RWF",
    kind: "counterparty_sent",
    value: "name:jean & co",
  });
  const sp = Object.fromEntries(new URL(href, "https://x.test").searchParams);
  // A relative preset would mean a different period tomorrow.
  assertEquals([sp.period, sp.from, sp.to], [
    "custom",
    "2026-11-01",
    "2026-11-16",
  ]);
  assertEquals(parseDrilldown(sp), {
    kind: "counterparty_sent",
    value: "name:jean & co",
    currency: "RWF",
  });
  const back = parseInsightsQuery(sp, "2027-01-01");
  assertEquals([back.fromKey, back.toKey], ["2026-11-01", "2026-11-16"]);

  // The figure's currency must not come back as a page filter.
  assertEquals(back.currency, undefined);

  assertEquals(parseDrilldown({ kind: "everything", cur: "RWF" }), null);
  assertEquals(parseDrilldown({ kind: "money_in" }), null);
  assertEquals(parseDrilldown({ kind: "money_in", currency: "RWF" }), null);
  assertEquals(parseDrilldown({ kind: "category", cur: "RWF" }), null);
  assertEquals(parseDrilldown({ kind: "money_in", cur: "RWF", value: "x" }), {
    kind: "money_in",
    currency: "RWF",
  });
});

function row(p: Partial<InsightRow> & { id: string }): InsightRow {
  return {
    direction: "out",
    transaction_type: "merchant_payment",
    currency: "RWF",
    amount_rwf: 0,
    fee_rwf: 0,
    principal_effect_rwf: 0,
    fee_effect_rwf: 0,
    category: null,
    counterparty_name: null,
    financial_source_id: SRC_A,
    settlement_state: "settled",
    occurred_at: "2026-11-10T10:00:00+00:00",
    ...p,
  };
}

Deno.test("mapper: null effects are a gap, not zero", () => {
  assertEquals(
    toInsightFact(row({ id: "a", principal_effect_rwf: null })),
    { excluded: "uncomputed" },
  );
  assertEquals(
    toInsightFact(row({ id: "b", fee_effect_rwf: null })),
    { excluded: "uncomputed" },
  );
  assertEquals(
    toInsightFact(row({ id: "c", principal_effect_rwf: 12.5 })),
    { excluded: "uncomputed" },
  );
  assertEquals(
    toInsightFact(row({ id: "d", settlement_state: null })),
    { excluded: "unknownSettlement" },
  );
  assertEquals(
    toInsightFact(row({ id: "e", settlement_state: "unknown" })),
    { excluded: "unknownSettlement" },
  );
  assertEquals(
    toInsightFact(row({ id: "f", settlement_state: "reversed" })),
    { excluded: "reversed" },
  );
});

Deno.test("mapper: pending without computed effects falls back to the stated amount", () => {
  const m = toInsightFact(row({
    id: "p",
    settlement_state: "pending",
    principal_effect_rwf: null,
    fee_effect_rwf: null,
    amount_rwf: 5000,
    fee_rwf: 100,
  }));
  if (!("fact" in m)) throw new Error("expected a fact");
  assertEquals(
    [m.fact.principalEffectRwf, m.fact.feeEffectRwf, m.fact.settlement],
    [-5000, -100, "pending"],
  );
});

Deno.test("mapper: bigint-as-string and instants are normalised", () => {
  const m = toInsightFact(row({
    id: "s",
    principal_effect_rwf: "-2500",
    fee_effect_rwf: "0",
    occurred_at: "2026-11-10T12:00:00+02:00",
  }));
  if (!("fact" in m)) throw new Error("expected a fact");
  assertEquals(m.fact.principalEffectRwf, -2500);
  assertEquals(m.fact.occurredAt, "2026-11-10T10:00:00.000Z");
});

Deno.test("boundary: a row exactly at local midnight belongs to the day it starts", () => {
  // PostgREST's "+00:00" form sorts BEFORE the ".000Z" bound as a string; the
  // mapper's normalisation is what keeps this row in the period.
  const q = parseInsightsQuery({
    period: "custom",
    from: "2026-11-01",
    to: "2026-11-01",
  }, "2026-11-16");
  const w = resolveWindow(q, "Africa/Kigali");
  const { facts } = toInsightFacts([
    row({
      id: "start",
      principal_effect_rwf: -100,
      occurred_at: "2026-10-31T22:00:00+00:00",
    }),
    row({
      id: "next-day",
      principal_effect_rwf: -900,
      occurred_at: "2026-11-01T22:00:00+00:00",
    }),
  ]);
  const o = computeOverview(facts, scopeFor(q, w.from, w.to), new Set());
  assertEquals(o.currencies[0].moneyOutMinor, 100n);
});

Deno.test("fixture: rows -> page figures, hand-computed", () => {
  const q = parseInsightsQuery({
    period: "custom",
    from: "2026-11-01",
    to: "2026-11-30",
  }, "2026-12-05");
  const w = resolveWindow(q, "Africa/Kigali");
  const rows: InsightRow[] = [
    row({ id: "salary", direction: "in", transaction_type: "money_received", principal_effect_rwf: 500000, counterparty_name: "Employer", category: "Salary" }),
    row({ id: "in-fee", direction: "in", transaction_type: "money_received", principal_effect_rwf: 20000, fee_effect_rwf: -200, counterparty_name: "Jean", financial_source_id: SRC_B }),
    row({ id: "food1", principal_effect_rwf: -30000, fee_effect_rwf: -300, category: "Food", counterparty_name: "Simba" }),
    row({ id: "food2", principal_effect_rwf: -10000, category: "Food", counterparty_name: "simba " }),
    row({ id: "refund", direction: "in", transaction_type: "refund", principal_effect_rwf: 4000, category: "Food", counterparty_name: "Simba" }),
    row({ id: "cash", transaction_type: "cash_withdrawal", principal_effect_rwf: -50000, fee_effect_rwf: -1000 }),
    row({ id: "nosrc", principal_effect_rwf: -7000, financial_source_id: null }),
    // own-wallet transfer pair (linked)
    row({ id: "t-out", transaction_type: "bank_transfer", principal_effect_rwf: -100000 }),
    row({ id: "t-in", direction: "in", transaction_type: "money_received", principal_effect_rwf: 100000, financial_source_id: SRC_B }),
    // not counted
    row({ id: "pend", settlement_state: "pending", principal_effect_rwf: -8000 }),
    row({ id: "fail", settlement_state: "failed", principal_effect_rwf: -9000 }),
    row({ id: "unk", settlement_state: null, principal_effect_rwf: -1 }),
    row({ id: "rev", settlement_state: "reversed", principal_effect_rwf: -1 }),
    row({ id: "raw", principal_effect_rwf: null }),
    row({ id: "usd", currency: "USD", principal_effect_rwf: -25 }),
    // previous period (October)
    row({ id: "oct", principal_effect_rwf: -40000, occurred_at: "2026-10-15T10:00:00+00:00" }),
  ];
  const { facts, excluded } = toInsightFacts(rows);
  assertEquals(excluded, { unknownSettlement: 1, reversed: 1, uncomputed: 1 });
  const linked = new Set(["t-out", "t-in"]);
  const scope = scopeFor(q, w.from, w.to);
  const all = computeOverview(facts, scope, linked);
  assertEquals(all.currencies.map((c) => c.currency), ["RWF", "USD"]);
  const o = all.currencies[0];

  assertEquals(o.moneyInMinor, 520000n);
  // food 30300 + 10000, cash 51000, no-source 7000, inbound fee 200, less refund 4000
  assertEquals(o.moneyOutMinor, 94500n);
  assertEquals(o.netMinor, 425500n);
  assertEquals(o.transfersExcluded, { amountMinor: 100000n, count: 2 });
  assertEquals(o.pending, { amountMinor: 8000n, count: 1 });
  assertEquals(o.failedCount, 1);
  assertEquals(
    o.byCategory.map((c) => [c.category, c.amountMinor]),
    [["Cash out", 51000n], ["Food", 36300n], ["Uncategorized", 7000n], [
      "Fees",
      200n,
    ]],
  );
  // The wallet table must add up to the headline, including the remainder.
  assertEquals(unassignedAccountRemainder(o), {
    moneyInMinor: 0n,
    moneyOutMinor: 7000n,
  });

  // Every drill-down the page links to reproduces its figure's rows.
  const ids = (f: Parameters<typeof applyDrilldown>[1]) =>
    applyDrilldown(facts, f, linked).map((x) => x.id).sort();
  assertEquals(ids(o.drilldowns.money_in), ["in-fee", "salary"]);
  assertEquals(ids(o.drilldowns.transfers), ["t-in", "t-out"]);
  assertEquals(ids(o.drilldowns.pending), ["pend"]);
  assertEquals(ids(o.byCategory[1].drilldown), ["food1", "food2", "refund"]);
  const simba = o.counterparties.find((c) => c.key === "name:simba")!;
  assertEquals(simba.sentMinor, 40300n);
  assertEquals(ids(simba.drilldownSent), ["food1", "food2"]);

  // Comparison with October (one 40,000 spend), and with no history at all.
  const prev = computeOverview(
    facts,
    scopeFor(q, w.prevFrom, w.from),
    linked,
  ).currencies.find((c) => c.currency === "RWF");
  const full = compareOverviews(o, prev, "full");
  assertEquals(full.moneyOut.deltaMinor, 54500n);
  assertEquals(full.moneyIn.previousMinor, 0n);
  assertEquals(full.moneyIn.deltaBps, null); // from zero: no percentage
  const none = compareOverviews(o, prev, "none");
  assertEquals(none.moneyOut.deltaMinor, null);

  // Wallet filter narrows through the same scope.
  const onlyB = computeOverview(
    facts,
    scopeFor({ ...q, sourceIds: [SRC_B] }, w.from, w.to),
    linked,
  ).currencies[0];
  assertEquals([onlyB.moneyInMinor, onlyB.moneyOutMinor], [20000n, 200n]);
});

Deno.test("history coverage: none / partial / full", () => {
  const prevFrom = "2026-10-01T22:00:00.000Z";
  const from = "2026-10-31T22:00:00.000Z";
  assertEquals(historyCoverage(null, prevFrom, from), "none");
  assertEquals(historyCoverage("2026-11-02T00:00:00+00:00", prevFrom, from), "none");
  assertEquals(historyCoverage(from, prevFrom, from), "none");
  assertEquals(historyCoverage("2026-10-10T00:00:00+00:00", prevFrom, from), "partial");
  assertEquals(historyCoverage("2026-09-01T00:00:00+00:00", prevFrom, from), "full");
});

Deno.test("formatting: bigint money and truncated percentages", () => {
  assertEquals(formatMoney(1234567n, "RWF"), "1,234,567 RWF");
  assertEquals(formatMoney(-500n, "RWF"), "−500 RWF");
  assertEquals(formatMoney(500n, "USD", { signed: true }), "+500 USD");
  assertEquals(formatMoney(0n, "RWF", { signed: true }), "0 RWF");
  assertEquals(
    formatMoney(123456789012345678901n, "RWF"),
    "123,456,789,012,345,678,901 RWF",
  );
  assertEquals(formatBps(7654), "76.5%");
  assertEquals(formatBps(9999), "99.9%");
  assertEquals(formatBps(-250), "−2.5%");
  assertEquals(formatBps(0), "0.0%");
});
