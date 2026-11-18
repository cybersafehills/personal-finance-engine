import { assertEquals } from "jsr:@std/assert@1";
import { estimateDailyRates, type RateTxn } from "./run-rate.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const t = (
  id: string,
  direction: "in" | "out",
  amountMinor: number,
  ago: number,
  recurringKey: string | null = null,
): RateTxn => ({
  id,
  direction,
  amountMinor,
  occurredAt: day(ago),
  recurringKey,
});
const none = new Set<string>();
const base = {
  windowDays: 90,
  nowMs: NOW,
  linked: none,
  recurringKeys: none,
  truncated: false,
};

// 12 outs of 1,000 and 4 ins of 9,000 spread across the window.
const sample: RateTxn[] = [
  ...Array.from({ length: 12 }, (_, i) => t(`o${i}`, "out", 1_000, 5 + i * 6)),
  ...Array.from({ length: 4 }, (_, i) => t(`i${i}`, "in", 9_000, 10 + i * 20)),
];

Deno.test("both sides: money in is estimated alongside spending", () => {
  const r = estimateDailyRates(sample, base);
  assertEquals(r.dailyOutMinor, Math.round(12_000 / 90));
  assertEquals(r.dailyInMinor, Math.round(36_000 / 90));
  assertEquals(r.outCount, 12);
  assertEquals(r.inCount, 4);
});

Deno.test("own transfers (linked legs) are neither spending nor income", () => {
  const withTransfer = [
    ...sample,
    t("tOut", "out", 500_000, 3),
    t("tIn", "in", 500_000, 3),
  ];
  const r = estimateDailyRates(withTransfer, {
    ...base,
    linked: new Set(["tOut", "tIn"]),
  });
  assertEquals(r, estimateDailyRates(sample, base));
});

Deno.test("recurring payments are scheduled separately, not counted as everyday spend", () => {
  const rec = [
    ...sample,
    ...Array.from(
      { length: 3 },
      (_, i) => t(`r${i}`, "out", 3_600, 4 + i * 30, "rent::"),
    ),
  ];
  const r = estimateDailyRates(rec, {
    ...base,
    recurringKeys: new Set(["rent::"]),
  });
  assertEquals(r.dailyOutMinor, Math.round(12_000 / 90));
});

Deno.test("not enough rows: that side is not trusted (0), the other still is", () => {
  const fewIns = sample.filter((x) => !(x.direction === "in" && x.id !== "i0"));
  const r = estimateDailyRates(fewIns, base);
  assertEquals(r.dailyInMinor, 0); // 1 < 3
  assertEquals(r.dailyOutMinor > 0, true);
  const fewOuts = sample.filter((x) => x.direction === "in" || x.id === "o0");
  assertEquals(estimateDailyRates(fewOuts, base).dailyOutMinor, 0); // 1 < 10
});

Deno.test("a capped read divides by the days it actually reached, not the full window", () => {
  // The newest rows only reach back 30 days; dividing by 90 would understate by 3x.
  const recent = Array.from(
    { length: 30 },
    (_, i) => t(`n${i}`, "out", 1_000, 1 + i),
  );
  const capped = estimateDailyRates(recent, { ...base, truncated: true });
  assertEquals(capped.observedDays, 30);
  assertEquals(capped.dailyOutMinor, Math.round(30_000 / 30));
  const notCapped = estimateDailyRates(recent, { ...base, truncated: false });
  assertEquals(notCapped.observedDays, 90);
});

Deno.test("under 21 observed days: neither rate is trusted", () => {
  const brief = Array.from(
    { length: 40 },
    (_, i) => t(`b${i}`, i % 2 ? "in" : "out", 1_000, 1 + (i % 10)),
  );
  const r = estimateDailyRates(brief, { ...base, truncated: true });
  assertEquals(r.observedDays < 21, true);
  assertEquals([r.dailyOutMinor, r.dailyInMinor], [0, 0]);
});

Deno.test("rows outside the window, in the future or with a bad date are ignored", () => {
  const odd = [...sample, t("old", "out", 9_999_999, 400), {
    ...t("fut", "out", 9_999_999, 0),
    occurredAt: new Date(NOW + 86_400_000).toISOString(),
  }, { ...t("bad", "out", 9_999_999, 0), occurredAt: "not a date" }];
  assertEquals(estimateDailyRates(odd, base), estimateDailyRates(sample, base));
});

Deno.test("empty history is all zeros", () => {
  assertEquals(estimateDailyRates([], base), {
    dailyOutMinor: 0,
    dailyInMinor: 0,
    observedDays: 90,
    outCount: 0,
    inCount: 0,
    windfallCount: 0,
  });
});

Deno.test("a one-off windfall is left out of typical income, and counted", () => {
  const ins = [
    ...Array.from({ length: 5 }, (_, i) => t(`n${i}`, "in", 2_000, 5 + i * 10)),
    t("big", "in", 400_000, 12),
  ];
  const outs = Array.from(
    { length: 12 },
    (_, i) => t(`o${i}`, "out", 1_000, 5 + i * 6),
  );
  const r = estimateDailyRates([...outs, ...ins], base);
  assertEquals(r.windfallCount, 1);
  assertEquals(r.inCount, 5);
  assertEquals(r.dailyInMinor, Math.round(10_000 / 90));
});

Deno.test("too few receipts to judge: nothing is called a windfall", () => {
  const few = [
    t("a", "in", 1_000, 5),
    t("b", "in", 90_000, 15),
    t("c", "in", 1_000, 25),
  ];
  const outs = Array.from(
    { length: 12 },
    (_, i) => t(`o${i}`, "out", 1_000, 5 + i * 6),
  );
  const r = estimateDailyRates([...outs, ...few], base);
  assertEquals(r.windfallCount, 0);
  assertEquals(r.inCount, 3);
});
