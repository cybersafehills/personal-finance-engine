import { bpsFraction, categorySummary, compareText, formatBps, netTone } from "../display";
import { minor, parseDrilldownResponse, parseInsightsResponse } from "../parse";
import { insightPeriods } from "../period";
import type { Comparison } from "../types";

const dd = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind, value: null, currency: "RWF", from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", account_ids: null, ...extra,
});

// Same shape the web API produces (serializeOverview), values hand-computed.
const currencyBlock = (over: Record<string, unknown> = {}) => ({
  currency: "RWF",
  money_in_minor: "500000", money_out_minor: "60600", net_minor: "439400",
  refunds_minor: "0", cash_out_minor: "50500", consumption_out_minor: "10100",
  count_in: 1, count_out: 2,
  transfers_excluded: { amount_minor: "30000", count: 2 },
  pending: { amount_minor: "7000", count: 1 },
  failed_count: 0,
  by_category: [
    { category: "Cash out", amount_minor: "50500", count: 1, percent_bps: 8333, drilldown: dd("category", { value: "Cash out" }) },
    { category: "Food", amount_minor: "10100", count: 1, percent_bps: 1666, drilldown: dd("category", { value: "Food" }) },
  ],
  by_account: [],
  top_counterparties: [{ key: "name:sam", display_name: "Sam", sent_minor: "10100", received_minor: "0", net_minor: "-10100", count: 1 }],
  drilldowns: { money_in: dd("money_in"), money_out: dd("money_out"), transfers: dd("transfers"), pending: dd("pending"), cash_out: dd("cash_out"), refunds: dd("refunds") },
  compare: { money_in: { current_minor: "500000", previous_minor: null, delta_minor: null, delta_bps: null }, money_out: { current_minor: "60600", previous_minor: "2000", delta_minor: "58600", delta_bps: 293000 }, net: { current_minor: "439400", previous_minor: "-2000", delta_minor: "441400", delta_bps: 22070 } },
  trend: null,
  ...over,
});
const body = (currencies: unknown[]) => ({
  ok: true, workspace_id: "w1", limits: { max_rows: 20000 },
  overview: { period: { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", tz: "Africa/Kigali" }, currencies, freshness: { latest_txn_at: "2026-08-08T08:00:00Z" } },
});

describe("parseInsightsResponse", () => {
  it("parses amounts as bigint, categories, people and comparisons", () => {
    const r = parseInsightsResponse(200, body([currencyBlock()]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.overview.currencies[0];
    expect([c.moneyInMinor, c.moneyOutMinor, c.netMinor]).toEqual([BigInt(500000), BigInt(60600), BigInt(439400)]);
    expect(c.byCategory.map((x) => x.category)).toEqual(["Cash out", "Food"]);
    expect(c.topPeople[0].displayName).toBe("Sam");
    expect(c.compare?.moneyIn.previousMinor).toBeNull(); // no history is null, never a fabricated 0
    expect(c.compare?.moneyOut.deltaBps).toBe(293000);
    expect(r.overview.latestTxnAt).toBe("2026-08-08T08:00:00Z");
  });

  it("keeps full precision beyond Number.MAX_SAFE_INTEGER", () => {
    const big = "9007199254740993";
    const r = parseInsightsResponse(200, body([currencyBlock({ money_out_minor: big })]));
    expect(r.ok && r.overview.currencies[0].moneyOutMinor).toBe(BigInt(big));
  });

  it("counts unsupported currencies instead of dropping them silently", () => {
    const r = parseInsightsResponse(200, body([currencyBlock(), currencyBlock({ currency: "GBP" })]));
    expect(r.ok && [r.overview.currencies.length, r.overview.skippedCurrencies]).toEqual([1, 1]);
  });

  it("refuses a malformed currency block entirely (never half-shown)", () => {
    expect(parseInsightsResponse(200, body([currencyBlock({ money_in_minor: 500000 })])).ok).toBe(false);
    expect(parseInsightsResponse(200, body([currencyBlock({ money_in_minor: "12.5" })])).ok).toBe(false);
    expect(parseInsightsResponse(200, body([currencyBlock({ drilldowns: {} })])).ok).toBe(false);
  });

  it("maps failures to something the screen can act on", () => {
    const f = (s: number) => {
      const r = parseInsightsResponse(s, { ok: false });
      return r.ok ? null : r;
    };
    expect(f(404)?.reason).toBe("unavailable");
    expect(f(401)?.reason).toBe("unauthorized");
    expect(f(403)?.reason).toBe("mfa_required");
    expect(f(422)?.message).toMatch(/shorter period/);
    expect(f(500)?.reason).toBe("error");
  });

  it("an empty period is a valid, empty result", () => {
    const r = parseInsightsResponse(200, body([]));
    expect(r.ok && r.overview.currencies).toEqual([]);
  });
});

describe("parseDrilldownResponse", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "t1", direction: "out", transaction_type: "cash_withdrawal", amount_minor: "-50500", currency: "RWF",
    category: null, counterparty_name: null, account_id: "a1", status: "settled", occurred_at: "2026-08-06T08:00:00Z", ...over,
  });
  it("parses rows and drops malformed ones", () => {
    const r = parseDrilldownResponse(200, { ok: true, total: 3, transactions: [row(), row({ id: "bad", amount_minor: 5 }), row({ id: "t2", direction: "sideways" })] });
    expect(r.ok && r.total).toBe(3);
    expect(r.ok && r.transactions.map((t) => [t.id, t.amountMinor])).toEqual([["t1", BigInt(-50500)]]);
  });
  it("a bad total fails the whole response", () => {
    expect(parseDrilldownResponse(200, { ok: true, total: "3", transactions: [] }).ok).toBe(false);
  });
});

describe("minor", () => {
  it("accepts only plain integer strings", () => {
    expect(minor("-12")).toBe(BigInt(-12));
    for (const bad of [12, "1.5", "1e3", "", " 1", null, undefined, "12345678901234567890"]) expect(minor(bad)).toBeNull();
  });
});

describe("display", () => {
  it("formats basis points by truncation", () => {
    expect(formatBps(7654)).toBe("76.5%");
    expect(formatBps(0)).toBe("0.0%");
    expect(formatBps(-1234)).toBe("−12.3%");
    expect(formatBps(10000)).toBe("100.0%");
    expect(bpsFraction(25000)).toBe(1);
    expect(bpsFraction(-5)).toBe(0);
  });
  const cmp = (over: Partial<Comparison>): Comparison => ({ currentMinor: BigInt(100), previousMinor: BigInt(50), deltaMinor: BigInt(50), deltaBps: 10000, ...over });
  it("says so when there is nothing to compare with, and never shows a fake change", () => {
    expect(compareText(cmp({ previousMinor: null, deltaMinor: null, deltaBps: null }), "RWF")).toBe("No earlier period to compare with");
    expect(compareText(cmp({ deltaMinor: BigInt(0), deltaBps: 0 }), "RWF")).toBe("Same as the previous period");
  });
  it("describes ups and downs in words and amounts", () => {
    expect(compareText(cmp({}), "RWF")).toBe("Up from the previous period by RWF 50 (100.0%)");
    expect(compareText(cmp({ deltaMinor: BigInt(-50), deltaBps: -5000 }), "RWF")).toBe("Down from the previous period by RWF 50 (50.0%)");
    expect(compareText(cmp({ deltaBps: null }), "RWF")).toBe("Up from the previous period by RWF 50");
  });
  it("net tone and category summary are text, not colour alone", () => {
    expect(netTone(BigInt(5))).toBe("positive");
    expect(netTone(BigInt(-5))).toBe("attention");
    expect(netTone(BigInt(0))).toBe("neutral");
    expect(categorySummary("Food", BigInt(10100), 1666, 1, "RWF")).toBe("Food: RWF 10,100, 16.6% of money out, 1 transaction");
  });
});

describe("insightPeriods (Africa/Kigali days, `to` exclusive)", () => {
  // 2026-08-15T10:00Z is 12:00 in Kigali.
  const p = insightPeriods(new Date("2026-08-15T10:00:00Z"));
  const by = Object.fromEntries(p.map((x) => [x.id, x]));
  it("this month runs from the Kigali 1st to the next month's 1st", () => {
    expect(by.this_month.from).toBe("2026-07-31T22:00:00.000Z");
    expect(by.this_month.to).toBe("2026-08-31T22:00:00.000Z");
  });
  it("last month ends exactly where this month starts", () => {
    expect(by.last_month.to).toBe(by.this_month.from);
    expect(by.last_month.from).toBe("2026-06-30T22:00:00.000Z");
  });
  it("last 30 days is 30 whole Kigali days ending tomorrow's midnight", () => {
    expect(by.last_30_days.to).toBe("2026-08-15T22:00:00.000Z");
    expect(by.last_30_days.from).toBe("2026-07-16T22:00:00.000Z");
    expect((Date.parse(by.last_30_days.to) - Date.parse(by.last_30_days.from)) / 86400000).toBe(30);
  });
  it("uses the Kigali date near midnight UTC (23:30Z is already tomorrow in Kigali)", () => {
    const q = insightPeriods(new Date("2026-08-31T23:30:00Z")); // 01:30 on 1 Sep in Kigali
    expect(q.find((x) => x.id === "this_month")!.from).toBe("2026-08-31T22:00:00.000Z");
  });
  it("wraps the year", () => {
    const j = insightPeriods(new Date("2026-01-10T10:00:00Z"));
    expect(j.find((x) => x.id === "last_month")!.from).toBe("2025-11-30T22:00:00.000Z");
    const d = insightPeriods(new Date("2026-12-10T10:00:00Z"));
    expect(d.find((x) => x.id === "this_month")!.to).toBe("2026-12-31T22:00:00.000Z");
  });
});


describe("Home trend response", () => {
  const point = {bucket_start:"2026-11-01",money_in_minor:"9007199254740993",money_out_minor:"100",net_minor:"9007199254740893"};
  it("preserves exact minor units in monthly buckets", () => {
    const r=parseInsightsResponse(200,body([currencyBlock({trend:[point]})]));
    expect(r.ok && r.overview.currencies[0].trend?.[0]).toEqual({bucketStart:"2026-11-01",moneyInMinor:9007199254740993n,moneyOutMinor:100n,netMinor:9007199254740893n});
  });
  it("does not turn malformed dates or amounts into a zero trend", () => {
    for (const bad of [{...point,bucket_start:"2026-02-30"},{...point,money_out_minor:100},{...point,net_minor:"bad"}]) {
      const r=parseInsightsResponse(200,body([currencyBlock({trend:[bad]})]));
      expect(r.ok && r.overview.currencies[0].trend).toBeNull();
    }
  });
});
