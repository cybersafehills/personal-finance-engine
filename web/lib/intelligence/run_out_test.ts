import { assertEquals } from "jsr:@std/assert@1";
import { aboutDays, runOutInDays } from "./run-out.ts";

// The real case that exposed the wording bug: RWF 14,416 and about RWF 12,300 a day going out.
const real = {
  horizonDays: 30,
  points: [{ dayOffset: 0, knownBalanceMinor: 14_416 }, {
    dayOffset: 30,
    knownBalanceMinor: 14_416,
  }],
  projectedEnd: { knownBalanceMinor: 14_416, estimatedBalanceMinor: -354_464 },
};

Deno.test("runOutInDays: the day the money is used up, not the day of the lowest point", () => {
  assertEquals(runOutInDays(real), 2); // low point is day 30; money is gone in ~1.2 days
});

Deno.test("runOutInDays: null when the balance stays above zero", () => {
  assertEquals(
    runOutInDays({
      ...real,
      projectedEnd: { knownBalanceMinor: 14_416, estimatedBalanceMinor: 9_000 },
    }),
    null,
  );
});

Deno.test("runOutInDays: a dated payment that empties the wallet in one step", () => {
  assertEquals(
    runOutInDays({
      horizonDays: 30,
      points: [
        { dayOffset: 0, knownBalanceMinor: 50_000 },
        { dayOffset: 10, knownBalanceMinor: -20_000 },
        { dayOffset: 30, knownBalanceMinor: -20_000 },
      ],
      projectedEnd: {
        knownBalanceMinor: -20_000,
        estimatedBalanceMinor: -20_000,
      },
    }),
    10,
  );
});

Deno.test("runOutInDays: already below zero today is 0", () => {
  assertEquals(
    runOutInDays({
      ...real,
      points: [{ dayOffset: 0, knownBalanceMinor: -5 }, {
        dayOffset: 30,
        knownBalanceMinor: -5,
      }],
    }),
    0,
  );
});

Deno.test("runOutInDays: income can make spending sustainable", () => {
  // estimated end above known end: net is positive, never runs out
  assertEquals(
    runOutInDays({
      ...real,
      projectedEnd: {
        knownBalanceMinor: 14_416,
        estimatedBalanceMinor: 80_000,
      },
    }),
    null,
  );
});

Deno.test("aboutDays", () => {
  assertEquals(aboutDays(0), "right away");
  assertEquals(aboutDays(1), "in about 1 day");
  assertEquals(aboutDays(5), "in about 5 days");
});
