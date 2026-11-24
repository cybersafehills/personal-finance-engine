import { hasSavingsActivity, parseSavings, parseSavingsResponse, periodOf, SAVINGS_PERIODS, savedPercent } from "../savings";

const period = (key: string, saved: string, would: string, plans: number, transfers: number) => ({
  key,
  savedMinor: saved,
  wouldHavePaidMinor: would,
  paidMinor: String(Number(would) - Number(saved)),
  plans,
  transfers,
});
const report = (over: Record<string, unknown> = {}) => ({
  periods: SAVINGS_PERIODS.map((p) => (p.key === "24h" ? period(p.key, "1000", "1500", 1, 2) : period(p.key, "1500", "3000", 2, 4))),
  inProgress: { plans: 1, expectedSavingMinor: "500" },
  recent: [{ planId: "p1", completedAt: "2026-11-24T10:00:00Z", totalMinor: "180000", savedMinor: "1000", transfers: 2 }],
  ...over,
});

describe("the savings periods", () => {
  it("are the seven windows asked for, in order", () => {
    expect(SAVINGS_PERIODS.map((p) => p.label)).toEqual([
      "Last 24 hours",
      "Last 7 days",
      "Last 2 weeks",
      "Last month",
      "Last 3 months",
      "Last 12 months",
      "All time",
    ]);
  });
});

describe("parseSavings", () => {
  it("reads every window with money as digit strings", () => {
    const s = parseSavings(report());
    expect(s && periodOf(s, "24h").savedMinor).toBe("1000");
    expect(s && periodOf(s, "all")).toMatchObject({ plans: 2, transfers: 4, savedMinor: "1500" });
    expect(s?.inProgress).toEqual({ plans: 1, expectedSavingMinor: "500" });
  });
  it("is no report, never a guessed zero, when a window or a figure is missing or bad", () => {
    expect(parseSavings(null)).toBeNull();
    expect(parseSavings(report({ periods: report().periods.slice(1) }))).toBeNull();
    expect(parseSavings(report({ periods: report().periods.map((p) => (p.key === "7d" ? { ...p, savedMinor: "-5" } : p)) }))).toBeNull();
    expect(parseSavings(report({ inProgress: null }))).toBeNull();
  });
  it("skips a malformed recent row without invalidating the totals", () => {
    const s = parseSavings(report({ recent: [{ planId: "p1" }, ...report().recent] }));
    expect(s?.recent).toHaveLength(1);
  });
  it("knows when there is nothing to say", () => {
    const empty = parseSavings(
      report({
        periods: SAVINGS_PERIODS.map((p) => period(p.key, "0", "0", 0, 0)),
        inProgress: { plans: 0, expectedSavingMinor: "0" },
        recent: [],
      }),
    );
    expect(empty && hasSavingsActivity(empty)).toBe(false);
    expect(hasSavingsActivity(parseSavings(report())!)).toBe(true);
  });
  it("gives the share saved as a whole percent, or nothing when there were no fees", () => {
    expect(savedPercent({ savedMinor: "1000", wouldHavePaidMinor: "1500" })).toBe(66);
    expect(savedPercent({ savedMinor: "0", wouldHavePaidMinor: "0" })).toBeNull();
  });
});

describe("parseSavingsResponse", () => {
  it("reads the response, and passes a 403 reason through", () => {
    expect(parseSavingsResponse(200, { ok: true, report: report() }).ok).toBe(true);
    expect(parseSavingsResponse(200, { ok: true, report: { periods: [] } }).ok).toBe(false);
    expect(parseSavingsResponse(403, { ok: false, error: "feature_disabled", message: "Save On is not turned on for your account." })).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });
});
