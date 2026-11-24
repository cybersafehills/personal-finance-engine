import { parseIntelligence } from "../intelligence";
import { scheduledItems } from "../story";
import type { WalletForecast } from "../forecast";

const WS = "10000000-0000-4000-8000-000000000002";

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    workspace_id: WS,
    computed_at: "2026-11-23T08:00:00.000Z",
    default_wallet_id: "w1",
    summary: { headline: "Your 30-day forecast has been updated.", body: "Open the forecast for the full breakdown." },
    baseline: { this_month_minor: "120000", usual_minor: "80000", change_percent: 50, direction: "above", months_compared: 3, basis: ["a"] },
    anomalies: [{ counterparty: "Mtn Rwanda", category: "Airtime", amount_minor: "18000", typical_minor: "2000", times_typical: 9, occurred_at: "2026-11-10T08:00:00Z" }],
    anomalies_total: 1,
    recurring: [{ counterparty: "Landlord", category: null, typical_amount_minor: "9007199254740993", typical_day: 5, months_seen: 3 }],
    recurring_total: 1,
    ...over,
  };
}

describe("parseIntelligence", () => {
  it("reads exact bigint amounts, including past 2^53", () => {
    const r = parseIntelligence(200, payload(), WS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.recurring[0].typicalAmount).toBe(9007199254740993n);
    expect(r.baseline?.thisMonth).toBe(120000n);
    expect(r.anomalies[0].timesTypical).toBe(9);
    expect(r.defaultWalletId).toBe("w1");
  });

  it("accepts an empty set: no baseline, no summary, nothing to list", () => {
    const r = parseIntelligence(200, payload({ summary: null, baseline: null, anomalies: [], anomalies_total: 0, recurring: [], recurring_total: 0, default_wallet_id: null }), WS);
    expect(r.ok).toBe(true);
  });

  it("maps statuses to something the screen can act on", () => {
    expect(parseIntelligence(404, null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseIntelligence(401, null)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseIntelligence(422, null)).toMatchObject({ ok: false, reason: "error" });
    expect(parseIntelligence(500, null)).toMatchObject({ ok: false, reason: "error" });
  });

  it.each([
    ["another Space's answer", { workspace_id: "other" }],
    ["a float amount", { baseline: { this_month_minor: "12.5", usual_minor: "1", change_percent: 1, direction: "above", months_compared: 2, basis: [] } }],
    ["an unknown direction", { baseline: { this_month_minor: "1", usual_minor: "1", change_percent: 1, direction: "sideways", months_compared: 2, basis: [] } }],
    ["a numeric (not string) amount", { anomalies: [{ counterparty: "X", category: null, amount_minor: 5, typical_minor: "1", times_typical: 3, occurred_at: "2026-11-10T08:00:00Z" }] }],
    ["a zero typical amount", { anomalies: [{ counterparty: "X", category: null, amount_minor: "10", typical_minor: "0", times_typical: 3, occurred_at: "2026-11-10T08:00:00Z" }], anomalies_total: 1 }],
    ["a total smaller than the list", { anomalies_total: 0 }],
    ["a day of month out of range", { recurring: [{ counterparty: "X", category: null, typical_amount_minor: "5", typical_day: 40, months_seen: 2 }] }],
    ["a bad timestamp", { computed_at: "yesterday" }],
    ["a half-built summary", { summary: { headline: "x" } }],
  ])("refuses %s whole rather than half-showing it", (_name, over) => {
    expect(parseIntelligence(200, payload(over), WS)).toMatchObject({ ok: false, reason: "error" });
  });

  it("refuses a body that is not the ok envelope", () => {
    expect(parseIntelligence(200, { ...payload(), ok: false }, WS).ok).toBe(false);
    expect(parseIntelligence(200, [], WS).ok).toBe(false);
  });
});

const wallet: WalletForecast = {
  id: "w1", name: "MoMo", balanceAsOf: null, opening: 1000n, scheduledEnd: 400n, estimatedEnd: 100n, noIncomeEnd: 0n,
  estimatesIncome: false, low: null, basis: [], disclaimer: "",
  points: [
    { day: 0, label: "Today", scheduled: 1000n, estimated: 1000n },
    { day: 2, label: "Rent", scheduled: 400n, estimated: 380n },
    { day: 7, label: "End", scheduled: 400n, estimated: 100n },
  ],
};

describe("scheduled items", () => {
  it("lists dated commitments with their change from the previous point", () => {
    expect(scheduledItems(wallet)).toEqual([
      { day: 2, label: "Rent", delta: -600n, balance: 400n },
      { day: 7, label: "End", delta: 0n, balance: 400n },
    ]);
  });
});

