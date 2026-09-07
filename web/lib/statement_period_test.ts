import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  addMonthsToDateKey,
  firstOfMonthDateKey,
  formatStatementDayLabel,
  MAX_STATEMENT_RANGE_DAYS,
  resolveStatementPeriod,
} from "./statement-period.ts";

const KIGALI = "Africa/Kigali"; // UTC+2, no DST
const NOW = new Date("2026-09-07T09:00:00Z"); // 11:00 Kigali -> local date 2026-09-07

function ok(res: ReturnType<typeof resolveStatementPeriod>) {
  assert(res.ok, `expected ok, got: ${res.ok ? "" : res.error}`);
  return res.period;
}

Deno.test("firstOfMonthDateKey collapses to the 1st", () => {
  assertEquals(firstOfMonthDateKey("2026-09-07"), "2026-09-01");
  assertEquals(firstOfMonthDateKey("2026-02-28"), "2026-02-01");
});

Deno.test("addMonthsToDateKey clamps the day to the target month length", () => {
  assertEquals(addMonthsToDateKey("2026-01-31", 1), "2026-02-28");
  assertEquals(addMonthsToDateKey("2026-03-31", -1), "2026-02-28");
  assertEquals(addMonthsToDateKey("2026-12-15", 1), "2027-01-15");
  assertEquals(addMonthsToDateKey("2026-09-07", -3), "2026-06-07");
  assertEquals(addMonthsToDateKey("2026-09-07", -12), "2025-09-07");
});

Deno.test("formatStatementDayLabel is day-first long form", () => {
  assertEquals(formatStatementDayLabel("2026-08-01"), "1 August 2026");
  assertEquals(formatStatementDayLabel("2026-12-31"), "31 December 2026");
});

Deno.test("this_month: 1st of the local month to now", () => {
  const p = ok(
    resolveStatementPeriod({
      preset: "this_month",
      timezone: KIGALI,
      now: NOW,
    }),
  );
  assertEquals(p.startDateKey, "2026-09-01");
  assertEquals(p.endDateKey, "2026-09-07");
  assertEquals(p.periodStartUtc.toISOString(), "2026-08-31T22:00:00.000Z");
  assertEquals(p.periodEndUtc.toISOString(), NOW.toISOString());
  assertEquals(p.label, "1 September 2026 – 7 September 2026");
  assertEquals(p.adjustments, []);
});

Deno.test("last_month: whole previous calendar month", () => {
  const p = ok(
    resolveStatementPeriod({
      preset: "last_month",
      timezone: KIGALI,
      now: NOW,
    }),
  );
  assertEquals(p.startDateKey, "2026-08-01");
  assertEquals(p.endDateKey, "2026-08-31");
  assertEquals(p.periodStartUtc.toISOString(), "2026-07-31T22:00:00.000Z");
  // exclusive end = local midnight of 1 September
  assertEquals(p.periodEndUtc.toISOString(), "2026-08-31T22:00:00.000Z");
  assertEquals(p.label, "1 August 2026 – 31 August 2026");
});

Deno.test("last_3_months / last_12_months: rolling window ending now", () => {
  const p3 = ok(
    resolveStatementPeriod({
      preset: "last_3_months",
      timezone: KIGALI,
      now: NOW,
    }),
  );
  assertEquals(p3.startDateKey, "2026-06-07");
  assertEquals(p3.endDateKey, "2026-09-07");
  assertEquals(p3.periodEndUtc.toISOString(), NOW.toISOString());

  const p12 = ok(
    resolveStatementPeriod({
      preset: "last_12_months",
      timezone: KIGALI,
      now: NOW,
    }),
  );
  assertEquals(p12.startDateKey, "2025-09-07");
});

Deno.test("custom: inclusive whole-day range", () => {
  const p = ok(resolveStatementPeriod({
    preset: "custom",
    timezone: KIGALI,
    fromDateKey: "2026-03-01",
    toDateKey: "2026-03-31",
    now: NOW,
  }));
  assertEquals(p.periodStartUtc.toISOString(), "2026-02-28T22:00:00.000Z");
  assertEquals(p.periodEndUtc.toISOString(), "2026-03-31T22:00:00.000Z");
  assertEquals(p.label, "1 March 2026 – 31 March 2026");
  assertEquals(p.adjustments, []);
});

Deno.test("custom: a future end date is clamped to today and surfaced", () => {
  const p = ok(resolveStatementPeriod({
    preset: "custom",
    timezone: KIGALI,
    fromDateKey: "2026-08-01",
    toDateKey: "2027-01-01",
    now: NOW,
  }));
  assertEquals(p.endDateKey, "2026-09-07");
  assertEquals(p.periodEndUtc.toISOString(), NOW.toISOString());
  assertEquals(p.adjustments.length, 1);
});

Deno.test("custom: start after end is rejected", () => {
  const res = resolveStatementPeriod({
    preset: "custom",
    timezone: KIGALI,
    fromDateKey: "2026-05-01",
    toDateKey: "2026-04-01",
    now: NOW,
  });
  assert(!res.ok);
});

Deno.test("custom: a start date in the future is rejected", () => {
  const res = resolveStatementPeriod({
    preset: "custom",
    timezone: KIGALI,
    fromDateKey: "2027-01-01",
    toDateKey: "2027-02-01",
    now: NOW,
  });
  assert(!res.ok);
});

Deno.test("custom: an impossible or badly formatted date is rejected", () => {
  for (
    const bad of ["2026-13-01", "2026-02-30", "2026-3-1", "not-a-date", ""]
  ) {
    const res = resolveStatementPeriod({
      preset: "custom",
      timezone: KIGALI,
      fromDateKey: bad,
      toDateKey: "2026-09-01",
      now: NOW,
    });
    assert(!res.ok, `expected ${bad} to be rejected`);
  }
});

Deno.test("custom: a range longer than the maximum is rejected", () => {
  const res = resolveStatementPeriod({
    preset: "custom",
    timezone: KIGALI,
    fromDateKey: "2020-01-01",
    toDateKey: "2026-01-01",
    now: NOW,
  });
  assert(!res.ok);
});

Deno.test("custom: exactly the maximum range is allowed", () => {
  // 2024-09-08 .. 2026-09-08 inclusive -> exclusive end 2026-09-09.
  const p = ok(resolveStatementPeriod({
    preset: "custom",
    timezone: "UTC",
    fromDateKey: "2024-09-09",
    toDateKey: "2026-09-08",
    now: new Date("2026-09-30T00:00:00Z"),
  }));
  const spanDays = (p.periodEndUtc.getTime() - p.periodStartUtc.getTime()) /
    86_400_000;
  assert(spanDays <= MAX_STATEMENT_RANGE_DAYS);
});

Deno.test("an unknown timezone is rejected, not thrown", () => {
  const res = resolveStatementPeriod({
    preset: "this_month",
    timezone: "Not/AZone",
    now: NOW,
  });
  assert(!res.ok);
});

Deno.test("negative-offset zone: this_month start resolves to the right UTC instant", () => {
  const p = ok(resolveStatementPeriod({
    preset: "this_month",
    timezone: "America/New_York",
    now: new Date("2026-03-20T12:00:00Z"),
  }));
  assertEquals(p.startDateKey, "2026-03-01");
  // 1 March 2026 is still EST (UTC-5); DST starts 8 March.
  assertEquals(p.periodStartUtc.toISOString(), "2026-03-01T05:00:00.000Z");
});
