import { assertEquals } from "jsr:@std/assert@1";
import {
  dailyReportPeriod,
  localMidnightUtc,
  previousCompleteDayKey,
  shiftDateKey,
  zonedDateKey,
} from "./report-period.ts";

Deno.test("localMidnightUtc: Africa/Kigali (fixed UTC+2, no DST) matches the known offset", () => {
  const midnight = localMidnightUtc("2026-08-25", "Africa/Kigali");
  assertEquals(midnight.toISOString(), "2026-08-24T22:00:00.000Z");
});

Deno.test("localMidnightUtc: UTC itself has no offset", () => {
  const midnight = localMidnightUtc("2026-08-25", "UTC");
  assertEquals(midnight.toISOString(), "2026-08-25T00:00:00.000Z");
});

Deno.test("localMidnightUtc: a negative-offset zone (America/New_York, EDT in August)", () => {
  const midnight = localMidnightUtc("2026-08-25", "America/New_York");
  // EDT = UTC-4 in August.
  assertEquals(midnight.toISOString(), "2026-08-25T04:00:00.000Z");
});

Deno.test("localMidnightUtc: correctly resolves EST (UTC-5) in winter, distinct from EDT", () => {
  const midnight = localMidnightUtc("2026-01-15", "America/New_York");
  assertEquals(midnight.toISOString(), "2026-01-15T05:00:00.000Z");
});

Deno.test("localMidnightUtc: DST spring-forward transition day (America/New_York, 2026-03-08) still resolves midnight correctly", () => {
  // Spring forward happens at 2am local on this date in 2026 - midnight
  // itself is unaffected (still EST, UTC-5), the transition happens later
  // in the same local day.
  const midnight = localMidnightUtc("2026-03-08", "America/New_York");
  assertEquals(midnight.toISOString(), "2026-03-08T05:00:00.000Z");
});

Deno.test("localMidnightUtc: the day AFTER a DST spring-forward is already on the new offset (EDT, UTC-4)", () => {
  const midnight = localMidnightUtc("2026-03-09", "America/New_York");
  assertEquals(midnight.toISOString(), "2026-03-09T04:00:00.000Z");
});

Deno.test("localMidnightUtc: DST fall-back transition day (America/New_York, 2026-11-01) resolves to the still-EDT offset", () => {
  const midnight = localMidnightUtc("2026-11-01", "America/New_York");
  assertEquals(midnight.toISOString(), "2026-11-01T04:00:00.000Z");
});

Deno.test("localMidnightUtc: the day AFTER a DST fall-back is on the new offset (EST, UTC-5)", () => {
  const midnight = localMidnightUtc("2026-11-02", "America/New_York");
  assertEquals(midnight.toISOString(), "2026-11-02T05:00:00.000Z");
});

Deno.test("zonedDateKey: round-trips localMidnightUtc back to the same date key", () => {
  const midnight = localMidnightUtc("2026-08-25", "Africa/Kigali");
  assertEquals(zonedDateKey(midnight, "Africa/Kigali"), "2026-08-25");
});

Deno.test("zonedDateKey: the same instant can fall on different calendar dates in different timezones", () => {
  // 2026-08-25T01:00:00Z is 2026-08-25 03:00 in Kigali (UTC+2) but
  // 2026-08-24 21:00 in New York (EDT, UTC-4).
  const instant = new Date("2026-08-25T01:00:00.000Z");
  assertEquals(zonedDateKey(instant, "Africa/Kigali"), "2026-08-25");
  assertEquals(zonedDateKey(instant, "America/New_York"), "2026-08-24");
});

Deno.test("shiftDateKey: simple forward/backward shift within a month", () => {
  assertEquals(shiftDateKey("2026-08-25", 1), "2026-08-26");
  assertEquals(shiftDateKey("2026-08-25", -1), "2026-08-24");
});

Deno.test("shiftDateKey: month boundary", () => {
  assertEquals(shiftDateKey("2026-08-31", 1), "2026-09-01");
  assertEquals(shiftDateKey("2026-09-01", -1), "2026-08-31");
});

Deno.test("shiftDateKey: year boundary", () => {
  assertEquals(shiftDateKey("2026-12-31", 1), "2027-01-01");
  assertEquals(shiftDateKey("2027-01-01", -1), "2026-12-31");
});

Deno.test("shiftDateKey: leap day (2028 is a leap year)", () => {
  assertEquals(shiftDateKey("2028-02-28", 1), "2028-02-29");
  assertEquals(shiftDateKey("2028-02-29", 1), "2028-03-01");
});

Deno.test("shiftDateKey: non-leap year has no Feb 29 (2026 is not a leap year)", () => {
  assertEquals(shiftDateKey("2026-02-28", 1), "2026-03-01");
});

Deno.test("dailyReportPeriod: produces a half-open [start, end) interval spanning exactly 24 hours for a fixed-offset zone", () => {
  const period = dailyReportPeriod("2026-08-25", "Africa/Kigali");
  assertEquals(period.periodStartUtc.toISOString(), "2026-08-24T22:00:00.000Z");
  assertEquals(period.periodEndUtc.toISOString(), "2026-08-25T22:00:00.000Z");
  assertEquals(
    period.periodEndUtc.getTime() - period.periodStartUtc.getTime(),
    24 * 60 * 60 * 1000,
  );
  assertEquals(period.dateKey, "2026-08-25");
});

Deno.test("dailyReportPeriod: a DST-transition day is NOT exactly 24 hours (spring-forward loses an hour)", () => {
  const period = dailyReportPeriod("2026-03-08", "America/New_York");
  // Midnight is EST (UTC-5); next midnight is already EDT (UTC-4) - only
  // 23 wall-clock hours later in real elapsed UTC terms is wrong framing;
  // what actually happens is the elapsed UTC duration is 24h exactly
  // (midnight-to-midnight always is, in UTC time), but the *local* wall
  // clock skips an hour during the day. Confirm the UTC boundaries
  // themselves are exactly what localMidnightUtc independently computes
  // for each date, proving the two boundaries are not naively "+24h".
  assertEquals(period.periodStartUtc.toISOString(), "2026-03-08T05:00:00.000Z");
  assertEquals(period.periodEndUtc.toISOString(), "2026-03-09T04:00:00.000Z");
});

Deno.test("previousCompleteDayKey: 'now' shortly after local midnight covers the day that just ended", () => {
  // 2026-08-25 00:05 in Kigali (UTC+2) = 2026-08-24T22:05:00Z.
  const now = new Date("2026-08-24T22:05:00.000Z");
  assertEquals(previousCompleteDayKey(now, "Africa/Kigali"), "2026-08-24");
});

Deno.test("previousCompleteDayKey: works correctly across a month boundary", () => {
  // 2026-09-01 00:05 Kigali time.
  const now = new Date("2026-08-31T22:05:00.000Z");
  assertEquals(previousCompleteDayKey(now, "Africa/Kigali"), "2026-08-31");
});
