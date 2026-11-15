import { barFraction, paceLabel, periodLabel, statusDisplay, totals, worstStatus } from "../display";
import { parseBudgetsResponse } from "../parse";
import type { BudgetAllocation } from "../types";

const alloc = (over: Partial<BudgetAllocation> = {}): BudgetAllocation => ({
  type: "WANTS",
  label: "Wants",
  targetMinor: 100000,
  actualMinor: 40000,
  remainingMinor: 60000,
  percentConsumed: 40,
  projectedMinor: 80000,
  status: "healthy",
  ...over,
});

const budget = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  name: "November",
  currency: "RWF",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  elapsedFraction: 0.5,
  actualIncomeMinor: 300000,
  allocations: [alloc()],
  alerts: [{ id: "a1", severity: "warning", message: "Heads up" }],
  uncategorizedCount: 2,
  uncategorizedMinor: 9000,
  unmappedCount: 0,
  unmappedMinor: 0,
  ...over,
});

describe("parseBudgetsResponse", () => {
  it("returns the budgets on success", () => {
    const r = parseBudgetsResponse(200, { ok: true, budgets: [budget()] });
    expect(r.ok && r.budgets).toHaveLength(1);
    expect(r.ok && r.budgets[0].allocations[0].label).toBe("Wants");
  });

  it("allows no active budget", () => {
    const r = parseBudgetsResponse(200, { ok: true, budgets: [] });
    expect(r).toEqual({ ok: true, budgets: [] });
  });

  it("skips malformed budgets, allocations and alerts instead of failing", () => {
    const r = parseBudgetsResponse(200, {
      ok: true,
      budgets: [
        budget({ id: "" }),
        budget({ currency: "JPY" }),
        budget({ periodStart: "soon" }),
        null,
        budget({
          allocations: [alloc(), { type: "X" }, alloc({ status: "weird" as never })],
          alerts: [{ id: "a1", severity: "loud", message: "x" }, { id: "a2", severity: "info", message: "ok" }],
        }),
      ],
    });
    expect(r.ok && r.budgets).toHaveLength(1);
    if (r.ok) {
      expect(r.budgets[0].allocations).toHaveLength(1);
      expect(r.budgets[0].alerts.map((a) => a.id)).toEqual(["a2"]);
    }
  });

  it("clamps elapsedFraction and zeroes bad counts", () => {
    const r = parseBudgetsResponse(200, {
      ok: true,
      budgets: [budget({ elapsedFraction: 7, uncategorizedCount: -3 })],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.budgets[0].elapsedFraction).toBe(1);
    expect(r.budgets[0].uncategorizedCount).toBe(0);
  });

  it("words each failure so it reads naturally on the screen", () => {
    expect(parseBudgetsResponse(404, {})).toMatchObject({ message: "Your budget isn't available yet." });
    expect(parseBudgetsResponse(403, {})).toMatchObject({
      message: "Finish two-step verification to see your budget.",
    });
    expect(parseBudgetsResponse(500, {})).toMatchObject({
      message: "Couldn't load your budget. Check your connection and try again.",
    });
  });

  it("maps each failure to a reason the screen can act on", () => {
    expect(parseBudgetsResponse(404, {})).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseBudgetsResponse(401, {})).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseBudgetsResponse(403, {})).toMatchObject({ ok: false, reason: "mfa_required" });
    expect(parseBudgetsResponse(500, {})).toMatchObject({ ok: false, reason: "error" });
    expect(parseBudgetsResponse(200, { ok: true })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("display", () => {
  it("labels every status", () => {
    expect(statusDisplay("healthy")).toEqual({ label: "On track", variant: "positive" });
    expect(statusDisplay("exceeded").variant).toBe("attention");
    expect(statusDisplay("insufficient_data").variant).toBe("neutral");
  });

  it("finds the worst status", () => {
    expect(worstStatus([])).toBe("insufficient_data");
    expect(worstStatus([alloc(), alloc({ status: "at_risk" }), alloc({ status: "watch" })])).toBe("at_risk");
    expect(worstStatus([alloc({ status: "exceeded" }), alloc({ status: "at_risk" })])).toBe("exceeded");
  });

  it("fills bars between 0 and 1, full for spending against a zero target", () => {
    expect(barFraction(alloc({ percentConsumed: 40 }))).toBe(0.4);
    expect(barFraction(alloc({ percentConsumed: 130 }))).toBe(1);
    expect(barFraction(alloc({ percentConsumed: -5 }))).toBe(0);
    expect(barFraction(alloc({ percentConsumed: null, actualMinor: 500 }))).toBe(1);
    expect(barFraction(alloc({ percentConsumed: null, actualMinor: 0 }))).toBe(0);
  });

  it("totals the allocations", () => {
    const t = totals([alloc(), alloc({ targetMinor: 50000, actualMinor: 60000 })]);
    expect(t).toMatchObject({ targetMinor: 150000, actualMinor: 100000, remainingMinor: 50000 });
    expect(t.percentUsed).toBeCloseTo(66.67, 1);
    expect(totals([]).percentUsed).toBeNull();
  });

  it("writes the period and pace in plain words", () => {
    expect(periodLabel("2026-11-01", "2026-11-30")).toBe("1 Nov – 30 Nov");
    expect(periodLabel("2026-12-15", "2027-01-14")).toBe("15 Dec 2026 – 14 Jan 2027");
    expect(paceLabel(0.624)).toBe("62% of the period has passed");
    expect(paceLabel(null)).toBeNull();
  });
});
