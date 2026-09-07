import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseStatementQuery } from "./statement-nl.ts";

const NOW = new Date("2026-09-07T00:00:00Z");
const p = (t: string) => parseStatementQuery(t, NOW);

Deno.test("empty / unrecognised input", () => {
  assertEquals(p("").empty, true);
  assertEquals(p("hello there").empty, true);
});

Deno.test("detailed MTN statement for last month, money out only", () => {
  const r = p(
    "give me my detailed MTN MoMo statement for last month, money out only",
  );
  assertEquals(r.statementType, "detailed");
  assertEquals(r.sourceHint, "mtn");
  assertEquals(r.preset, "last_month");
  assertEquals(r.filters, { direction: "out" });
  assertEquals(r.empty, false);
});

Deno.test("named month without a year resolves to the most recent past occurrence", () => {
  // September 2026 is the current month -> "for August" = Aug 2026
  const aug = p("statement for August");
  assertEquals(aug.preset, "custom");
  assertEquals(aug.fromDateKey, "2026-08-01");
  assertEquals(aug.toDateKey, "2026-08-31");
  // "for November" would be in the future -> last year
  const nov = p("statement for November");
  assertEquals(nov.fromDateKey, "2025-11-01");
  assertEquals(nov.toDateKey, "2025-11-30");
});

Deno.test("named month with an explicit year", () => {
  const r = p("my statement for February 2024");
  assertEquals(r.fromDateKey, "2024-02-01");
  assertEquals(r.toDateKey, "2024-02-29"); // leap year
});

Deno.test("explicit from/to and between ranges", () => {
  const a = p("statement from 2026-03-01 to 2026-03-15");
  assertEquals(a.preset, "custom");
  assertEquals(a.fromDateKey, "2026-03-01");
  assertEquals(a.toDateKey, "2026-03-15");
  const b = p("transactions between 2026-01-10 and 2026-02-20");
  assertEquals(b.fromDateKey, "2026-01-10");
  assertEquals(b.toDateKey, "2026-02-20");
});

Deno.test("rolling presets", () => {
  assertEquals(p("last 3 months statement").preset, "last_3_months");
  assertEquals(p("past 6 months").preset, "last_6_months");
  assertEquals(p("statement for the last year").preset, "last_12_months");
  assertEquals(p("this month so far").preset, "this_month");
});

Deno.test("year to date", () => {
  const r = p("year to date statement");
  assertEquals(r.preset, "custom");
  assertEquals(r.fromDateKey, "2026-01-01");
  assertEquals(r.toDateKey, "2026-09-07");
});

Deno.test("all accounts / consolidated", () => {
  assertEquals(p("consolidated statement for last month").sourceHint, "");
  assertEquals(p("all accounts, this month").sourceHint, "");
});

Deno.test("airtel + bank hints", () => {
  assertEquals(p("airtel money statement last month").sourceHint, "airtel");
  assertEquals(p("my bank statement for July").sourceHint, "bank");
});

Deno.test("quoted / named account", () => {
  assertEquals(
    p('statement for my "Salary" account last month').sourceHint,
    "salary",
  );
  assertEquals(
    p("statement for the equity savings account this month").sourceHint,
    "equity savings",
  );
});

Deno.test("money in phrasings", () => {
  assertEquals(p("incoming only, last month").filters, { direction: "in" });
  assertEquals(p("credits only for August").filters, { direction: "in" });
});

Deno.test("understood list is populated for a rich query", () => {
  const r = p("detailed airtel statement for August, money in only");
  assert(r.understood.length >= 3);
});
