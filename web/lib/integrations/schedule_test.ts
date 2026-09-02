import { assertEquals } from "jsr:@std/assert@1";
import { computeNextRun } from "./schedule.ts";

Deno.test("daily: same day if the hour is still ahead", () => {
  const next = computeNextRun(
    { cadence: "daily", hour: 18 },
    new Date("2026-09-01T09:00:00Z"),
  );
  assertEquals(next, "2026-09-01T18:00:00.000Z");
});

Deno.test("daily: tomorrow if the hour has passed", () => {
  const next = computeNextRun(
    { cadence: "daily", hour: 6 },
    new Date("2026-09-01T09:00:00Z"),
  );
  assertEquals(next, "2026-09-02T06:00:00.000Z");
});

Deno.test("weekly: the next matching weekday", () => {
  // 2026-09-01 is a Tuesday; ask for Friday (dow 5)
  const next = computeNextRun(
    { cadence: "weekly", hour: 8, dayOfWeek: 5 },
    new Date("2026-09-01T09:00:00Z"),
  );
  assertEquals(next, "2026-09-04T08:00:00.000Z");
});

Deno.test("weekly: rolls to next week when today matches but the hour passed", () => {
  // 2026-09-01 Tuesday (dow 2), hour already past -> next Tuesday
  const next = computeNextRun(
    { cadence: "weekly", hour: 6, dayOfWeek: 2 },
    new Date("2026-09-01T09:00:00Z"),
  );
  assertEquals(next, "2026-09-08T06:00:00.000Z");
});

Deno.test("monthly: this month if the day is ahead", () => {
  const next = computeNextRun(
    { cadence: "monthly", hour: 7, dayOfMonth: 15 },
    new Date("2026-09-01T09:00:00Z"),
  );
  assertEquals(next, "2026-09-15T07:00:00.000Z");
});

Deno.test("monthly: next month if the day has passed, wrapping the year", () => {
  const next = computeNextRun(
    { cadence: "monthly", hour: 7, dayOfMonth: 1 },
    new Date("2026-12-05T09:00:00Z"),
  );
  assertEquals(next, "2027-01-01T07:00:00.000Z");
});

Deno.test("offsetMinutes shifts the local hour into UTC", () => {
  // Kigali is UTC+2 (120 min). 06:00 local == 04:00 UTC.
  const next = computeNextRun(
    { cadence: "daily", hour: 6, offsetMinutes: 120 },
    new Date("2026-09-01T00:00:00Z"),
  );
  assertEquals(next, "2026-09-01T04:00:00.000Z");
});
