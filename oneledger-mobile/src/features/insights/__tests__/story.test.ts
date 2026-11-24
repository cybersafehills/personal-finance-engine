import { buildOutlookChart } from "../chart";
import type { WalletForecast } from "../forecast";
import { commitmentLine, datedPayments, dayLabel, endLine, firstDayBelowZero, largePaymentLine, outlookFor, outlookSeries, paceStory, repeatingLine, sectionPlan, shapeOf, summaryRows, walkRows, worstOutlook, type Outlook } from "../story";

const NOW = "2026-11-24T08:00:00Z";
const wallet = (over: Partial<WalletForecast> = {}): WalletForecast => ({
  id: "w", name: "MTN MoMo", balanceAsOf: "2026-11-19T06:47:00Z", opening: 14_416n,
  scheduledEnd: 14_416n, estimatedEnd: -354_464n, noIncomeEnd: -400_424n, estimatesIncome: true, low: { day: 30, amount: -400_424n },
  points: [{ day: 0, label: "Today", scheduled: 14_416n, estimated: 14_416n }, { day: 30, label: "Day 30", scheduled: 14_416n, estimated: -354_464n }],
  basis: [], disclaimer: "x", ...over,
});

describe("when the money runs out", () => {
  it("finds the day the money is used up, not the day of the lowest point (the real bug)", () => {
    const w = wallet();
    // RWF 14,416 and about RWF 12,300 going out a day: gone in about 2 days, even though the lowest point is on day 30.
    const day = firstDayBelowZero(shapeOf(w), shapeOf(w).netExpected);
    expect(day).toBeGreaterThan(1);
    expect(day).toBeLessThan(2);
    const o = outlookFor(w, 30, false, NOW);
    expect(o.tone).toBe("alert");
    expect(o.title).toBe("Your money may run out in about 2 days");
    expect(o.message).toContain("RWF 14,416");
    expect(o.message).toContain("26 Nov");
  });
  it("is on track when money outlasts the horizon", () => {
    const o = outlookFor(wallet({ opening: 900_000n, scheduledEnd: 900_000n, estimatedEnd: 500_000n, noIncomeEnd: 300_000n, points: [{ day: 0, label: "Today", scheduled: 900_000n, estimated: 900_000n }, { day: 30, label: "Day 30", scheduled: 900_000n, estimated: 500_000n }] }), 30, false, NOW);
    expect(o.tone).toBe("good");
    expect(o.message).toContain("about RWF 500,000 after 30 days");
    expect(o.message).toContain("about RWF 300,000 if nothing new comes in");
  });
  it("warns separately when only the no-new-money case runs out", () => {
    const o = outlookFor(wallet({ opening: 100_000n, scheduledEnd: 100_000n, estimatedEnd: 10_000n, noIncomeEnd: -200_000n, points: [{ day: 0, label: "Today", scheduled: 100_000n, estimated: 100_000n }, { day: 30, label: "Day 30", scheduled: 100_000n, estimated: 10_000n }] }), 30, false, NOW);
    expect(o.tone).toBe("watch");
    expect(o.title).toBe("Fine if your usual income arrives");
    expect(o.cautiousRunsOutInDays).not.toBeNull();
  });
  it("catches a dated payment that empties the wallet in one step", () => {
    const w = wallet({ opening: 50_000n, scheduledEnd: -20_000n, estimatedEnd: -20_000n, noIncomeEnd: -20_000n, estimatesIncome: false,
      points: [{ day: 0, label: "Today", scheduled: 50_000n, estimated: 50_000n }, { day: 10, label: "Rent", scheduled: -20_000n, estimated: -20_000n }, { day: 30, label: "Day 30", scheduled: -20_000n, estimated: -20_000n }] });
    expect(firstDayBelowZero(shapeOf(w), 0)).toBe(10);
    expect(outlookFor(w, 30, false, NOW).title).toBe("Your money may run out in about 10 days");
  });
  it("says so plainly when the balance is already below zero", () => {
    const w = wallet({ opening: -5_000n, scheduledEnd: -5_000n, estimatedEnd: -5_000n, noIncomeEnd: -5_000n, estimatesIncome: false,
      points: [{ day: 0, label: "Today", scheduled: -5_000n, estimated: -5_000n }, { day: 30, label: "Day 30", scheduled: -5_000n, estimated: -5_000n }] });
    expect(outlookFor(w, 30, false, NOW).title).toBe("Your balance is already below zero");
  });
  it("shows no amounts while amounts are hidden", () => {
    expect(outlookFor(wallet(), 30, true, NOW).message).not.toMatch(/RWF|\d{2,}/);
    expect(outlookFor(wallet({ opening: 900_000n, scheduledEnd: 900_000n, estimatedEnd: 500_000n, noIncomeEnd: 300_000n, points: [{ day: 0, label: "Today", scheduled: 900_000n, estimated: 900_000n }, { day: 30, label: "Day 30", scheduled: 900_000n, estimated: 500_000n }] }), 30, true, NOW).message).not.toMatch(/RWF/);
  });
  it("labels days on the Kigali calendar", () => {
    expect(dayLabel(NOW, 2)).toBe("26 Nov");
    expect(dayLabel("2026-12-30T10:00:00Z", 3)).toBe("2 Jan");
  });
});

describe("the walk from today's balance to the end", () => {
  it("adds up exactly", () => {
    const w = wallet({ opening: 100_000n, scheduledEnd: 70_000n, noIncomeEnd: -50_000n, estimatedEnd: 30_000n });
    const rows = walkRows(w, 30, false);
    expect(rows.map((r) => r.key)).toEqual(["start", "bills", "spending", "income", "end"]);
    const [start, bills, spending, income, end] = rows.map((r) => r.amount);
    expect(start + bills + spending + income).toBe(end);
    expect(rows[1].text).toBe("−RWF 30,000");
    expect(rows[3].text).toBe("+RWF 80,000");
  });
  it("leaves out the income row when no income is estimated", () => {
    expect(walkRows(wallet({ estimatesIncome: false }), 30, false).some((r) => r.key === "income")).toBe(false);
  });
});

describe("the chart series", () => {
  it("drops on a dated payment instead of sloping into it", () => {
    const w = wallet({ opening: 50_000n, scheduledEnd: -20_000n, estimatedEnd: -20_000n, noIncomeEnd: -20_000n, estimatesIncome: false,
      points: [{ day: 0, label: "Today", scheduled: 50_000n, estimated: 50_000n }, { day: 10, label: "Rent", scheduled: -20_000n, estimated: -20_000n }, { day: 30, label: "Day 30", scheduled: -20_000n, estimated: -20_000n }] });
    const s = outlookSeries(w).filter((p) => p.day === 10);
    expect(s).toHaveLength(2);
    expect(s[0].expected).toBe(50_000);
    expect(s[1].expected).toBe(-20_000);
  });
});

describe("plain wording for the fact sections", () => {
  const baseline = { thisMonth: 492_420n, usual: 576_535n, changePercent: 15, direction: "below" as const, monthsCompared: 3, basis: [] };
  it("explains spending pace without jargon or negative-money notation", () => {
    const s = paceStory(baseline, false);
    expect(s.title).toBe("15% less than usual");
    expect(s.sentence).toBe("You have spent RWF 492,420 so far this month. By this point you usually have spent RWF 576,535.");
    expect(s.tone).toBe("good");
    expect(paceStory({ ...baseline, direction: "above", changePercent: 20 }, false).tone).toBe("watch");
    expect(paceStory(baseline, true).sentence).not.toMatch(/RWF/);
  });
  it("describes large and repeating payments plainly", () => {
    expect(largePaymentLine({ counterparty: "Kenia", category: null, amount: 13_750n, typical: 3_600n, timesTypical: 3.8, occurredAt: "x" }, false)).toEqual({ who: "Kenia", detail: "RWF 13,750, about 3.8 times your usual RWF 3,600" });
    expect(repeatingLine({ counterparty: "Adiel", category: "Transport", typicalAmount: 2_100n, typicalDay: 13, monthsSeen: 2 }, false).detail).toBe("About RWF 2,100 · Transport · usually around the 13th, seen in 2 of the last 4 months");
    expect(repeatingLine({ counterparty: "X", category: null, typicalAmount: 1_500n, typicalDay: 1, monthsSeen: 3 }, false).detail).toContain("around the 1st");
    expect(repeatingLine({ counterparty: "X", category: null, typicalAmount: 1_500n, typicalDay: 22, monthsSeen: 3 }, false).detail).toContain("around the 22nd");
  });
});

describe("outlook chart geometry", () => {
  it("places the zero line and the run-out marker, and collapses identical lines", () => {
    const series = [{ day: 0, expected: 100, cautious: 100 }, { day: 30, expected: -200, cautious: -300 }];
    const m = buildOutlookChart(series, 30, 10)!;
    expect(m.zeroY).not.toBeNull();
    expect(m.runsOut!.y).toBe(m.zeroY);
    expect(m.sameLines).toBe(false);
    expect(buildOutlookChart([{ day: 0, expected: 5, cautious: 5 }, { day: 30, expected: 9, cautious: 9 }], 30, null)!.sameLines).toBe(true);
    expect(buildOutlookChart(series.slice(0, 1), 30, null)).toBeNull();
  });
});


describe("plain phrases", () => {
  it("never shows a bare negative balance", () => {
    expect(endLine(wallet(), 30, false)).toBe("Short by about RWF 354,464 after 30 days");
    expect(endLine(wallet({ estimatedEnd: 500_000n }), 30, false)).toBe("About RWF 500,000 left after 30 days");
    expect(endLine(wallet(), 30, true)).not.toMatch(/\d{3}/);
  });
  it("says which way a dated payment moves in words", () => {
    expect(commitmentLine(-600n, false)).toBe("Pays out RWF 600");
    expect(commitmentLine(900n, false)).toBe("Comes in RWF 900");
    expect(commitmentLine(0n, false)).toBe("No change");
    expect(commitmentLine(-600n, true)).toBe("Pays out");
  });
});

describe("Home summary rows", () => {
  const base = { baseline: { thisMonth: 492_420n, usual: 576_535n, changePercent: -15, direction: "below" as const, monthsCompared: 3, basis: [] },
    anomalies: [{ counterparty: "Kenia", category: null, amount: 13_750n, typical: 3_600n, timesTypical: 3.8, occurredAt: "2026-11-10T08:00:00Z" }], anomaliesTotal: 2,
    recurring: [{ counterparty: "A", category: null, typicalAmount: 2_100n, typicalDay: 13, monthsSeen: 2 }, { counterparty: "B", category: null, typicalAmount: 1_500n, typicalDay: 5, monthsSeen: 2 }], recurringTotal: 2 };
  it("is at most four short rows, however much activity there is", () => {
    const rows = summaryRows(base, wallet(), 30, false);
    expect(rows.map((r) => r.key)).toEqual(["outlook", "pace", "large", "repeat"]);
    expect(rows[3].detail).toBe("About RWF 3,600 a month in total");
    expect(rows.every((r) => r.title.length < 45)).toBe(true);
  });
  it("leaves out what it has nothing to say about, and hides amounts when asked", () => {
    expect(summaryRows(null, null, 30, false)).toEqual([]);
    expect(summaryRows(base, wallet(), 30, true).map((r) => r.detail).join(" ")).not.toMatch(/RWF/);
  });
});


const verdict = (tone: Outlook["tone"]): Outlook => ({ tone, title: "t", message: "m", runsOutInDays: null, cautiousRunsOutInDays: null });
const pace = (tone: "good" | "watch" | "neutral") => ({ tone, title: "t", sentence: "s", spent: 1n, usual: 1n, fraction: 1 });

describe("section plan: what needs attention comes first", () => {
  it("puts an urgent outlook first, then things worth a look, then information, then what is fine", () => {
    const plan = sectionPlan({ outlook: verdict("alert"), pace: pace("good"), largeCount: 2, repeatCount: 4 });
    expect(plan.map((s) => `${s.id}:${s.tone}`)).toEqual(["outlook:urgent", "large:check", "repeat:info", "pace:good"]);
    expect(plan[0].status).toBe("Needs attention");
  });
  it("lets a healthy outlook sit below something that needs a look", () => {
    const plan = sectionPlan({ outlook: verdict("good"), pace: pace("watch"), largeCount: 1, repeatCount: 0 });
    expect(plan.map((s) => s.id)).toEqual(["pace", "large", "outlook"]);
  });
  it("keeps the usual order for equal importance and omits what has nothing to say", () => {
    const plan = sectionPlan({ outlook: null, pace: pace("watch"), largeCount: 3, repeatCount: 0 });
    expect(plan.map((s) => s.id)).toEqual(["pace", "large"]);
    expect(sectionPlan({ outlook: null, pace: null, largeCount: 0, repeatCount: 0 })).toEqual([]);
  });
  it("an in-line month is simply fine", () => {
    expect(sectionPlan({ outlook: null, pace: pace("neutral"), largeCount: 0, repeatCount: 0 })[0].tone).toBe("good");
  });
  it("shows the most serious verdict when several wallets are listed", () => {
    expect(worstOutlook([verdict("good"), verdict("alert"), verdict("watch")])!.tone).toBe("alert");
    expect(worstOutlook([])).toBeNull();
  });
});

describe("dated payments", () => {
  it("does not treat the closing checkpoint as a payment", () => {
    const w = wallet({ opening: 14_416n, scheduledEnd: 14_416n, points: [{ day: 0, label: "Today", scheduled: 14_416n, estimated: 14_416n }, { day: 14, label: "Day 14", scheduled: 14_416n, estimated: 0n }] });
    expect(datedPayments(w)).toEqual([]);
  });
  it("keeps a real payment", () => {
    const w = wallet({ opening: 50_000n, scheduledEnd: 49_400n, points: [{ day: 0, label: "Today", scheduled: 50_000n, estimated: 50_000n }, { day: 5, label: "Rent", scheduled: 49_400n, estimated: 49_400n }, { day: 30, label: "Day 30", scheduled: 49_400n, estimated: 49_400n }] });
    expect(datedPayments(w).map((i) => [i.label, i.delta])).toEqual([["Rent", -600n]]);
  });
});
