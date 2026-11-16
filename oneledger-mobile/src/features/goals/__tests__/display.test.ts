import { dayLabel, goalTypeLabel, isReached, paceNotes, percentComplete, sortGoals } from "../display";
import type { Goal } from "../types";

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g1",
  type: "emergency_fund",
  name: "Rainy day",
  description: null,
  currency: "RWF",
  targetMinor: 1_000_000,
  currentMinor: 250_000,
  targetDate: "2027-06-30",
  status: "active",
  progress: {
    pctComplete: 25,
    monthsToTarget: 7.5,
    requiredMonthlyMinor: 100_000,
    recentMonthlyRateMinor: 50_000,
    projectedCompletionDate: "2028-01-10",
  },
  ...over,
});
const fmt = (n: number) => `RWF ${n.toLocaleString("en-US")}`;

describe("dayLabel / goalTypeLabel", () => {
  it("formats a date key with the year", () => {
    expect(dayLabel("2027-06-30")).toBe("30 Jun 2027");
    expect(dayLabel("2026-01-05")).toBe("5 Jan 2026");
  });
  it("labels goal types like the web", () => {
    expect(goalTypeLabel("debt")).toBe("Debt repayment");
    expect(goalTypeLabel("planned_purchase")).toBe("Planned purchase");
  });
});

describe("percentComplete", () => {
  it("prefers the database's figure", () => {
    expect(percentComplete(goal({ progress: { ...goal().progress!, pctComplete: 33.3 } }))).toBe(33.3);
  });
  it("falls back to current / target and clamps", () => {
    expect(percentComplete(goal({ progress: null }))).toBe(25);
    expect(percentComplete(goal({ progress: null, currentMinor: 5_000_000 }))).toBe(100);
    expect(percentComplete(goal({ progress: null, targetMinor: 0 }))).toBe(0);
  });
});

describe("paceNotes", () => {
  it("says what to save and when the current pace gets there", () => {
    expect(paceNotes(goal(), fmt)).toEqual([
      "Save about RWF 100,000 a month to reach it by 30 Jun 2027.",
      "At your recent pace you'd reach it around 10 Jan 2028.",
    ]);
  });
  it("says so when the target date has passed", () => {
    const g = goal({ progress: { ...goal().progress!, monthsToTarget: -2, requiredMonthlyMinor: 0 } });
    expect(paceNotes(g, fmt)[0]).toBe("The target date (30 Jun 2027) has passed.");
  });
  it("does not invent a projection without contributions", () => {
    const g = goal({ targetDate: null, progress: { ...goal().progress!, projectedCompletionDate: null } });
    expect(paceNotes(g, fmt)).toEqual(["No contributions in the last 3 months, so there's no projection yet."]);
  });
  it("is silent for reached, non-active and unknown-progress goals", () => {
    expect(paceNotes(goal({ currentMinor: 1_000_000 }), fmt)).toEqual([]);
    expect(paceNotes(goal({ status: "archived" }), fmt)).toEqual([]);
    expect(paceNotes(goal({ progress: null }), fmt)).toEqual([]);
  });
});

describe("isReached / sortGoals", () => {
  it("needs a positive target", () => {
    expect(isReached({ currentMinor: 0, targetMinor: 0 })).toBe(false);
    expect(isReached({ currentMinor: 10, targetMinor: 10 })).toBe(true);
  });
  it("puts active first, keeps order within a status", () => {
    const ids = sortGoals([
      goal({ id: "a", status: "archived" }),
      goal({ id: "b", status: "active" }),
      goal({ id: "c", status: "completed" }),
      goal({ id: "d", status: "active" }),
    ]).map((g) => g.id);
    expect(ids).toEqual(["b", "d", "c", "a"]);
  });
});
