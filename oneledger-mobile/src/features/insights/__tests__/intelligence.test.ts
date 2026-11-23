import { buildChart } from "../chart";
import { parseIntelligence } from "../intelligence";
import { baselineSentence, projectionLines, recurringLine, scheduledItems, unusualHeading, unusualLine } from "../intelligence-display";
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

describe("wording", () => {
  const b = { thisMonth: 120000n, usual: 80000n, changePercent: 50, direction: "above" as const, monthsCompared: 3, basis: [] };
  it("says what the baseline means in the web's words", () => {
    expect(baselineSentence(b, false)).toBe("−RWF 120,000 so far, 50% above your recent pace (usually −RWF 80,000 by now).");
    expect(baselineSentence({ ...b, direction: "in_line", changePercent: 3 }, false)).toContain("about the same as your recent pace");
    expect(baselineSentence({ ...b, direction: "below", changePercent: -20 }, false)).toContain("20% below");
  });
  it("shows no amount at all while amounts are hidden", () => {
    for (const text of [
      baselineSentence(b, true),
      unusualLine({ counterparty: "Mtn", category: null, amount: 18000n, typical: 2000n, timesTypical: 9, occurredAt: "x" }, true),
      recurringLine({ counterparty: "Landlord", category: "Rent", typicalAmount: 150000n, typicalDay: 5, monthsSeen: 3 }, true),
    ]) expect(text).not.toMatch(/\d{3}/);
  });
  it("pluralises headings", () => {
    expect(unusualHeading(1)).toBe("An unusually large payment");
    expect(unusualHeading(3)).toBe("3 unusually large payments");
  });
  it("formats unusual and recurring lines", () => {
    expect(unusualLine({ counterparty: "Mtn", category: null, amount: 18000n, typical: 2000n, timesTypical: 9.5, occurredAt: "x" }, false))
      .toBe("Mtn · −RWF 18,000 · about 9.5× your usual −RWF 2,000");
    expect(recurringLine({ counterparty: "Landlord", category: "Rent", typicalAmount: 150000n, typicalDay: 5, monthsSeen: 3 }, false))
      .toBe("Landlord · Rent · ~−RWF 150,000 · around day 5 · seen 3 months");
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

describe("projection + scheduled items", () => {
  it("keeps the scheduled and estimated halves separate", () => {
    expect(projectionLines(wallet, 7, false).detail).toBe("Scheduled items only: RWF 400 · with everyday spending: RWF 100");
    expect(projectionLines({ ...wallet, estimatedEnd: 400n }, 7, false).detail).toBe("Scheduled items only: RWF 400");
    expect(projectionLines({ ...wallet, estimatesIncome: true }, 7, false).detail).toBe("If nothing new comes in: RWF 0 · with your usual income: RWF 100");
    expect(projectionLines(wallet, 7, true).detail).toBe("Amounts are hidden.");
  });
  it("lists dated commitments with their change from the previous point", () => {
    expect(scheduledItems(wallet)).toEqual([
      { day: 2, label: "Rent", delta: -600n, balance: 400n },
      { day: 7, label: "End", delta: 0n, balance: 400n },
    ]);
  });
});

describe("buildChart", () => {
  const pts = wallet.points.map((p) => ({ day: p.day, scheduled: p.scheduled, estimated: p.estimated }));
  it("draws one path per series from the server's points", () => {
    const m = buildChart(pts, 7, null)!;
    expect(m.scheduledPath.startsWith("M8.0,")).toBe(true);
    expect(m.scheduledPath.match(/L/g)).toHaveLength(2);
    expect(m.zeroY).toBeNull(); // all balances positive: no zero line
    expect(m.low).toBeNull();
  });
  it("marks the zero line and the low point when the balance goes negative", () => {
    const m = buildChart([{ day: 0, scheduled: 100n, estimated: 100n }, { day: 7, scheduled: 100n, estimated: -300n }], 7, { day: 7, amount: -300n })!;
    expect(m.zeroY).not.toBeNull();
    expect(m.low!.x).toBeCloseTo(308, 0);
    expect(m.low!.y).toBeGreaterThan(m.zeroY!);
  });
  it("refuses to draw from fewer than two points and never divides by zero", () => {
    expect(buildChart([pts[0]], 7, null)).toBeNull();
    expect(buildChart([{ day: 0, scheduled: 0n, estimated: 0n }, { day: 7, scheduled: 0n, estimated: 0n }], 7, null)).not.toBeNull();
  });
});
