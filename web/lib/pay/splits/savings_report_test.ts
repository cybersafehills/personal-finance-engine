import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  hasSavingsActivity,
  isSavingsPeriod,
  parseSavingsReport,
  periodOf,
  SAVINGS_PERIODS,
  savedPercent,
} from "./savings-report.ts";

const period = (key: string, saved: number, would: number, plans: number, transfers: number) => ({
  key,
  saved_minor: saved,
  would_have_paid_minor: would,
  paid_minor: would - saved,
  plans,
  transfers,
});
const raw = (over: Record<string, unknown> = {}) => ({
  generated_at: "2026-11-24T12:00:00Z",
  currency: "RWF",
  periods: [
    period("24h", 1000, 1500, 1, 2),
    period("7d", 1000, 1500, 1, 2),
    period("14d", 1500, 3000, 2, 4),
    period("30d", 1500, 3000, 2, 4),
    period("90d", 1500, 3000, 2, 4),
    period("365d", 1500, 3000, 2, 4),
    period("all", 1500, 3000, 2, 4),
  ],
  in_progress: { plans: 1, expected_saving_minor: 500 },
  recent: [{ plan_id: "p1", completed_at: "2026-11-24T10:00:00Z", total_minor: 180000, saved_minor: 1000, transfers: 2 }],
  ...over,
});

Deno.test("the periods are the seven windows the person asked for, in order", () => {
  assertEquals(SAVINGS_PERIODS.map((p) => p.label), [
    "Last 24 hours",
    "Last 7 days",
    "Last 2 weeks",
    "Last month",
    "Last 3 months",
    "Last 12 months",
    "All time",
  ]);
  assert(isSavingsPeriod("14d") && !isSavingsPeriod("2w"));
});

Deno.test("a report is read with money as digit strings and every window present", () => {
  const r = parseSavingsReport(raw());
  assert(r !== null);
  assertEquals(r.periods.length, 7);
  assertEquals(periodOf(r, "24h").savedMinor, "1000");
  assertEquals(periodOf(r, "all"), {
    key: "all", savedMinor: "1500", wouldHavePaidMinor: "3000", paidMinor: "1500", plans: 2, transfers: 4,
  });
  assertEquals(r.inProgress, { plans: 1, expectedSavingMinor: "500" });
  assertEquals(r.recent[0].savedMinor, "1000");
});

Deno.test("a report that is missing a window or has a bad figure is no report, never a guessed zero", () => {
  assertEquals(parseSavingsReport(null), null);
  assertEquals(parseSavingsReport(raw({ periods: raw().periods.slice(1) })), null);
  assertEquals(parseSavingsReport(raw({ periods: raw().periods.map((p) => (p.key === "7d" ? { ...p, saved_minor: -5 } : p)) })), null);
  assertEquals(parseSavingsReport(raw({ in_progress: null })), null);
  // A malformed recent row is skipped; it never invalidates the totals.
  const r = parseSavingsReport(raw({ recent: [{ plan_id: "p1" }, ...raw().recent] }));
  assertEquals(r?.recent.length, 1);
});

Deno.test("activity means something saved or still being sent", () => {
  assertEquals(hasSavingsActivity(parseSavingsReport(raw())!), true);
  const empty = raw({
    periods: SAVINGS_PERIODS.map((p) => period(p.key, 0, 0, 0, 0)),
    in_progress: { plans: 0, expected_saving_minor: 0 },
    recent: [],
  });
  assertEquals(hasSavingsActivity(parseSavingsReport(empty)!), false);
});

Deno.test("the saved share is a whole percent of the one-transfer fees, or null when there were none", () => {
  assertEquals(savedPercent({ savedMinor: "1000", wouldHavePaidMinor: "1500" }), 66);
  assertEquals(savedPercent({ savedMinor: "0", wouldHavePaidMinor: "0" }), null);
});
