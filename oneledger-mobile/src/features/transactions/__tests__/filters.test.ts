import { activeFilterCount, NO_FILTERS, periodStartUtc } from "../filters";

// Kigali is UTC+2, so local midnight is 22:00 UTC the day before.
const NOW = "2026-11-15T10:00:00Z"; // 12:00 on 15 Nov in Kigali

describe("periodStartUtc", () => {
  it("is null for all time", () => {
    expect(periodStartUtc("all", NOW)).toBeNull();
  });
  it("last 7 days starts six days before today (Kigali midnight)", () => {
    expect(periodStartUtc("7d", NOW)).toBe("2026-11-08T22:00:00.000Z");
  });
  it("last 30 days starts 29 days before today", () => {
    expect(periodStartUtc("30d", NOW)).toBe("2026-10-16T22:00:00.000Z");
  });
  it("this month starts on the 1st in Kigali", () => {
    expect(periodStartUtc("month", NOW)).toBe("2026-10-31T22:00:00.000Z");
  });
  it("uses the Kigali day, not the UTC day, near midnight", () => {
    // 23:30 UTC on 30 Nov is already 1 Dec in Kigali.
    expect(periodStartUtc("month", "2026-11-30T23:30:00Z")).toBe("2026-11-30T22:00:00.000Z");
  });
  it("crosses month and year boundaries", () => {
    expect(periodStartUtc("7d", "2027-01-03T10:00:00Z")).toBe("2026-12-27T22:00:00.000Z");
  });
});

describe("activeFilterCount", () => {
  it("counts only non-default choices", () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ direction: "in", period: "30d", needsReview: true })).toBe(3);
    expect(activeFilterCount({ ...NO_FILTERS, needsReview: true })).toBe(1);
  });
});
