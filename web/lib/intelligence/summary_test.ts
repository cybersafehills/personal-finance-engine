import { assertEquals } from "jsr:@std/assert@1";
import { type SummariseInput, summariseInsights } from "./summary.ts";

function input(over: Partial<SummariseInput> = {}): SummariseInput {
  return {
    enabled: true,
    forecast: {
      horizonDays: 30,
      projectedEnd: {
        knownBalanceMinor: 40_000,
        estimatedBalanceMinor: 20_000,
      },
      projectedLow: { dayOffset: 20, estimatedBalanceMinor: 12_000 },
      mayGoNegative: false,
    },
    baseline: null,
    anomalies: [],
    recurring: [],
    ...over,
  };
}

Deno.test("summariseInsights: null when disabled or empty", () => {
  assertEquals(summariseInsights(input({ enabled: false })), null);
  assertEquals(
    summariseInsights({
      enabled: true,
      forecast: null,
      baseline: null,
      anomalies: [],
      recurring: [],
    }),
    null,
  );
});

Deno.test("summariseInsights: signature stable across sub-bucket noise", () => {
  const a = summariseInsights(input({
    forecast: {
      horizonDays: 30,
      projectedEnd: {
        knownBalanceMinor: 40_000,
        estimatedBalanceMinor: 20_100,
      },
      projectedLow: { dayOffset: 20, estimatedBalanceMinor: 12_000 },
      mayGoNegative: false,
    },
  }))!;
  const b = summariseInsights(input({
    forecast: {
      horizonDays: 30,
      projectedEnd: {
        knownBalanceMinor: 40_000,
        estimatedBalanceMinor: 22_400,
      },
      projectedLow: { dayOffset: 20, estimatedBalanceMinor: 12_000 },
      mayGoNegative: false,
    },
  }))!;
  assertEquals(a.signature, b.signature); // both bucket to 20,000

  const c = summariseInsights(input({
    forecast: {
      horizonDays: 30,
      projectedEnd: {
        knownBalanceMinor: 40_000,
        estimatedBalanceMinor: 33_000,
      },
      projectedLow: { dayOffset: 20, estimatedBalanceMinor: 12_000 },
      mayGoNegative: false,
    },
  }))!;
  assertEquals(a.signature === c.signature, false); // buckets to 35,000
});

Deno.test("summariseInsights: negative forecast wins over an anomaly", () => {
  const g = summariseInsights(input({
    forecast: {
      horizonDays: 30,
      projectedEnd: {
        knownBalanceMinor: 40_000,
        estimatedBalanceMinor: -5_000,
      },
      projectedLow: { dayOffset: 28, estimatedBalanceMinor: -5_000 },
      mayGoNegative: true,
    },
    anomalies: [{ counterpartyKey: "xtreme lounge", timesTypical: 6 }],
  }))!;
  assertEquals(g.headline.startsWith("Heads up"), true);
});

Deno.test("summariseInsights: anomaly headline when the forecast is fine", () => {
  const g = summariseInsights(input({
    anomalies: [{ counterpartyKey: "xtreme lounge", timesTypical: 6 }],
  }))!;
  assertEquals(g.headline.includes("Xtreme Lounge"), true);
  assertEquals(g.headline.includes("6×"), true);
});

Deno.test("summariseInsights: baseline-above headline last", () => {
  const g = summariseInsights(input({
    baseline: { direction: "above", changePercent: 33, monthsCompared: 3 },
  }))!;
  assertEquals(g.headline.includes("33% above"), true);
});

Deno.test("summariseInsights: says when the money runs out, not the day of the lowest point", () => {
  const g = summariseInsights(input({
    forecast: {
      horizonDays: 30,
      projectedEnd: {
        knownBalanceMinor: 14_416,
        estimatedBalanceMinor: -354_464,
      },
      projectedLow: { dayOffset: 30, estimatedBalanceMinor: -354_464 },
      mayGoNegative: true,
      points: [
        { dayOffset: 0, knownBalanceMinor: 14_416 },
        { dayOffset: 30, knownBalanceMinor: 14_416 },
      ],
    },
  }))!;
  assertEquals(
    g.headline,
    "Heads up — at your recent pace, your money could run out in about 2 days.",
  );
  assertEquals(g.body.includes("day 30"), false);
});

Deno.test("summariseInsights: without checkpoints the warning stays general", () => {
  const g = summariseInsights(input({
    forecast: {
      horizonDays: 30,
      projectedEnd: { knownBalanceMinor: 0, estimatedBalanceMinor: -100 },
      projectedLow: { dayOffset: 30, estimatedBalanceMinor: -100 },
      mayGoNegative: true,
    },
  }))!;
  assertEquals(
    g.headline,
    "Heads up — your balance could go below zero within 30 days at your recent pace.",
  );
});
