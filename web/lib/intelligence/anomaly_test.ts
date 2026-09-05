import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type AnomalyCandidate,
  DEFAULT_ANOMALY_OPTIONS,
  detectAmountAnomalies,
} from "./anomaly.ts";

const SINCE = "2026-09-01T00:00:00Z";
const OPTS = { ...DEFAULT_ANOMALY_OPTIONS, since: SINCE };

function c(
  key: string,
  amount: number,
  day: string,
  category: string | null = null,
): AnomalyCandidate {
  return {
    counterpartyKey: key,
    category,
    amountMinor: amount,
    occurredAt: `2026-${day}T09:00:00Z`,
  };
}

Deno.test("flags a recent payment far above the counterparty's median", () => {
  const rows = [
    c("shop", 2_000, "08-01"),
    c("shop", 2_100, "08-08"),
    c("shop", 1_900, "08-15"),
    c("shop", 2_050, "08-22"),
    c("shop", 2_000, "08-29"),
    c("shop", 18_000, "09-05", "Food"), // recent, ~9x
  ];
  const [a] = detectAmountAnomalies(rows, OPTS);
  assertEquals(a.counterpartyKey, "shop");
  assertEquals(a.amountMinor, 18_000);
  assertEquals(a.typicalMinor, 2_000);
  assertEquals(a.timesTypical, 9);
  assertEquals(a.category, "Food");
});

Deno.test("does not flag a counterparty without enough history", () => {
  const rows = [
    c("new", 1_000, "08-20"),
    c("new", 1_000, "08-27"),
    c("new", 40_000, "09-03"),
  ];
  assertEquals(detectAmountAnomalies(rows, OPTS).length, 0);
});

Deno.test("does not flag when the big payment is not recent", () => {
  const rows = [
    c("x", 1_000, "07-01"),
    c("x", 1_000, "07-08"),
    c("x", 1_000, "07-15"),
    c("x", 1_000, "07-22"),
    c("x", 1_000, "07-29"),
    c("x", 30_000, "08-05"), // before `since`
  ];
  assertEquals(detectAmountAnomalies(rows, OPTS).length, 0);
});

Deno.test("does not flag a small absolute gap even at a high multiple", () => {
  const rows = [
    c("tiny", 100, "08-01"),
    c("tiny", 120, "08-08"),
    c("tiny", 110, "08-15"),
    c("tiny", 100, "08-22"),
    c("tiny", 105, "08-29"),
    c("tiny", 900, "09-05"), // ~9x but only +795 minor units
  ];
  assertEquals(detectAmountAnomalies(rows, OPTS).length, 0);
});

Deno.test("does not flag a counterparty whose amounts are just volatile", () => {
  // Median of the others is ~10k; the recent 22k is only ~2.2x -> below 3x.
  const rows = [
    c("v", 2_000, "08-01"),
    c("v", 20_000, "08-08"),
    c("v", 5_000, "08-15"),
    c("v", 15_000, "08-22"),
    c("v", 10_000, "08-29"),
    c("v", 22_000, "09-05"),
  ];
  assertEquals(detectAmountAnomalies(rows, OPTS).length, 0);
});

Deno.test("at most one anomaly per counterparty, largest multiple first across counterparties", () => {
  const base = (k: string) => [
    c(k, 1_000, "08-01"),
    c(k, 1_000, "08-08"),
    c(k, 1_000, "08-15"),
    c(k, 1_000, "08-22"),
    c(k, 1_000, "08-29"),
  ];
  const rows = [
    ...base("a"),
    c("a", 6_000, "09-02"),
    c("a", 9_000, "09-05"), // bigger recent offender for a
    ...base("b"),
    c("b", 20_000, "09-04"), // 20x
  ];
  const found = detectAmountAnomalies(rows, OPTS);
  assertEquals(found.length, 2);
  assertEquals(found[0].counterpartyKey, "b"); // 20x before 9x
  assertEquals(found[1].counterpartyKey, "a");
  assertEquals(found[1].amountMinor, 9_000);
  assert(found[0].timesTypical > found[1].timesTypical);
});
