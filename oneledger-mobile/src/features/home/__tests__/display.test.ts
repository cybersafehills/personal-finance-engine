import { daysLeftLabel, daysRemaining, homeStatus, usedFraction } from "../display";

describe("homeStatus", () => {
  it("uses the web's Home wording", () => {
    expect(homeStatus("healthy").label).toBe("On track");
    expect(homeStatus("watch").label).toBe("Approaching limit");
    expect(homeStatus("at_risk").label).toBe("Near limit");
    expect(homeStatus("exceeded").label).toBe("Over budget");
    expect(homeStatus("insufficient_data")).toEqual({ label: "Not enough data", variant: "neutral" });
  });

  it("is never alarming: no status uses a red variant", () => {
    for (const s of ["healthy", "watch", "at_risk", "exceeded", "insufficient_data"] as const) {
      expect(["positive", "attention", "neutral"]).toContain(homeStatus(s).variant);
    }
  });
});

describe("daysRemaining", () => {
  it("counts Kigali days to the last day of the period", () => {
    // 2026-11-15 19:54 Kigali = 17:54 UTC
    expect(daysRemaining("2026-11-30", "2026-11-15T17:54:00Z")).toBe(15);
    expect(daysRemaining("2026-11-15", "2026-11-15T17:54:00Z")).toBe(0);
  });

  it("uses the Kigali date, not the UTC one, around midnight", () => {
    // 22:30 UTC on the 15th is already the 16th in Kigali.
    expect(daysRemaining("2026-11-16", "2026-11-15T22:30:00Z")).toBe(0);
  });

  it("never goes negative and tolerates bad input", () => {
    expect(daysRemaining("2026-10-01", "2026-11-15T10:00:00Z")).toBe(0);
    expect(daysRemaining("nope", "2026-11-15T10:00:00Z")).toBeNull();
  });
});

describe("daysLeftLabel / usedFraction", () => {
  it("words the days like the web", () => {
    expect(daysLeftLabel(null)).toBeNull();
    expect(daysLeftLabel(0)).toBe("Last day");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(9)).toBe("9 days left");
  });

  it("clamps the bar and returns null without a target", () => {
    expect(usedFraction(null)).toBeNull();
    expect(usedFraction(-5)).toBe(0);
    expect(usedFraction(40)).toBe(0.4);
    expect(usedFraction(250)).toBe(1);
  });
});
