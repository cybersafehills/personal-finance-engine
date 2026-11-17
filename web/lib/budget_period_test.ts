import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { budgetPeriodState, monthPeriodFor, nameForMonth } from "./budget-period.ts";

Deno.test("period state: upcoming, current (both end days inclusive), ended", () => {
  assertEquals(budgetPeriodState("2026-09-01", "2026-09-30", "2026-08-31"), "upcoming");
  assertEquals(budgetPeriodState("2026-09-01", "2026-09-30", "2026-09-01"), "current");
  assertEquals(budgetPeriodState("2026-09-01", "2026-09-30", "2026-09-30"), "current");
  assertEquals(budgetPeriodState("2026-09-01", "2026-09-30", "2026-10-01"), "ended");
  // The case from the live app: an "active" September budget on Nov 17.
  assertEquals(budgetPeriodState("2026-09-01", "2026-09-30", "2026-11-17"), "ended");
});

Deno.test("month period: first and last day, including 28/29/30/31-day months and year ends", () => {
  assertEquals(monthPeriodFor("2026-11-17"), { periodStart: "2026-11-01", periodEnd: "2026-11-30", monthName: "November", year: 2026 });
  assertEquals(monthPeriodFor("2026-12-31").periodEnd, "2026-12-31");
  assertEquals(monthPeriodFor("2027-01-01").periodStart, "2027-01-01");
  assertEquals(monthPeriodFor("2027-02-10").periodEnd, "2027-02-28");
  assertEquals(monthPeriodFor("2028-02-10").periodEnd, "2028-02-29"); // leap year
  assertEquals(monthPeriodFor("2026-04-30").periodEnd, "2026-04-30");
});

Deno.test("month period: rejects malformed keys instead of guessing", () => {
  assertThrows(() => monthPeriodFor("2026-13-01"), RangeError);
  assertThrows(() => monthPeriodFor("2026-00-01"), RangeError);
  assertThrows(() => monthPeriodFor("nope"), RangeError);
  assertThrows(() => monthPeriodFor("2026-11-1"), RangeError);
});

Deno.test("the new month's period always sits after the ended one it replaces", () => {
  const ended = "2026-09-30";
  const next = monthPeriodFor("2026-11-17");
  assertEquals(next.periodStart > ended, true);
  assertEquals(budgetPeriodState(next.periodStart, next.periodEnd, "2026-11-17"), "current");
});

Deno.test("naming: a leading month is replaced, anything else is kept as written", () => {
  const nov = monthPeriodFor("2026-11-17");
  assertEquals(nameForMonth("September Budget", nov), "November Budget");
  assertEquals(nameForMonth("September 2026 Budget", nov), "November 2026 Budget");
  assertEquals(nameForMonth("  September Budget ", nov), "November Budget");
  assertEquals(nameForMonth("Household", nov), "Household");
  assertEquals(nameForMonth("Our September plan", nov), "Our September plan"); // not leading
  assertEquals(nameForMonth("Septembers", nov), "Septembers"); // not the month word
  assertEquals(nameForMonth("Budget", nov), "Budget");
});
