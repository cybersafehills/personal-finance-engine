import {
  dateGroupLabel,
  formatDateTime,
  formatFullDateTime,
  formatTime,
  kigaliDateKey,
  kigaliDayBoundsUtc,
} from "../kigali-time";

describe("kigaliDateKey", () => {
  it("rolls to the next day at 22:00 UTC (midnight in Kigali)", () => {
    expect(kigaliDateKey("2026-08-20T21:59:59Z")).toBe("2026-08-20");
    expect(kigaliDateKey("2026-08-20T22:00:00Z")).toBe("2026-08-21");
  });
  it("handles year boundaries and rejects junk", () => {
    expect(kigaliDateKey("2026-12-31T23:30:00Z")).toBe("2027-01-01");
    expect(() => kigaliDateKey("nope")).toThrow(RangeError);
  });
});

describe("kigaliDayBoundsUtc", () => {
  it("spans exactly one Kigali day", () => {
    const { startUtc, endUtc } = kigaliDayBoundsUtc("2026-08-20");
    expect(startUtc.toISOString()).toBe("2026-08-19T22:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-08-20T21:59:59.999Z");
    expect(kigaliDateKey(startUtc.toISOString())).toBe("2026-08-20");
    expect(kigaliDateKey(endUtc.toISOString())).toBe("2026-08-20");
  });
  it("rejects a malformed key", () => {
    expect(() => kigaliDayBoundsUtc("20-08-2026")).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("shows Kigali local time, 24-hour", () => {
    expect(formatTime("2026-08-20T12:03:00Z")).toBe("14:03");
    expect(formatTime("2026-08-20T22:05:00Z")).toBe("00:05");
    expect(formatDateTime("2026-08-20T12:03:00Z")).toBe("Aug 20, 14:03");
    expect(formatFullDateTime("2026-08-20T12:03:00Z")).toBe("20 August 2026, 14:03");
  });
});

describe("dateGroupLabel", () => {
  const now = "2026-08-20T10:00:00Z"; // 12:00 in Kigali on Aug 20
  it("labels today and yesterday by Kigali day, not UTC day", () => {
    expect(dateGroupLabel("2026-08-19T22:30:00Z", now)).toBe("Today");
    expect(dateGroupLabel("2026-08-19T21:30:00Z", now)).toBe("Yesterday");
    // 23:30 in Kigali on Aug 18: two days back, so it is named, not "Yesterday".
    expect(dateGroupLabel("2026-08-18T21:30:00Z", now)).toBe("August 18");
    expect(dateGroupLabel("2026-08-18T22:00:00Z", now)).toBe("Yesterday");
  });
  it("names older days, adding the year when it differs", () => {
    expect(dateGroupLabel("2026-08-18T10:00:00Z", now)).toBe("August 18");
    expect(dateGroupLabel("2025-12-25T10:00:00Z", now)).toBe("December 25, 2025");
  });
});
