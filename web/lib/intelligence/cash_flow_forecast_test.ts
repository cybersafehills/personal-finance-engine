import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  computeCashFlowForecast,
  type ScheduledMovement,
} from "./cash-flow-forecast.ts";

const RENT: ScheduledMovement = {
  label: "Rent",
  dayOffset: 5,
  amountMinor: -200_000,
  kind: "recurring_outflow",
  confidence: "high",
};
const SALARY: ScheduledMovement = {
  label: "Salary",
  dayOffset: 25,
  amountMinor: 500_000,
  kind: "recurring_inflow",
  confidence: "high",
};

Deno.test("no scheduled items, no estimate: the balance is flat", () => {
  const f = computeCashFlowForecast({
    currentBalanceMinor: 100_000,
    currency: "RWF",
    horizonDays: 30,
    scheduled: [],
    estimatedDailyDiscretionaryMinor: 0,
  });
  assertEquals(f.projectedEnd.knownBalanceMinor, 100_000);
  assertEquals(f.projectedEnd.estimatedBalanceMinor, 100_000);
  assertEquals(f.mayGoNegative, false);
  assertEquals(f.points[0].label, "Today");
});

Deno.test("known path applies scheduled inflows/outflows on their day", () => {
  const f = computeCashFlowForecast({
    currentBalanceMinor: 300_000,
    currency: "RWF",
    horizonDays: 30,
    scheduled: [RENT, SALARY],
    estimatedDailyDiscretionaryMinor: 0,
  });
  // 300k - 200k rent + 500k salary = 600k at horizon end.
  assertEquals(f.projectedEnd.knownBalanceMinor, 600_000);
  assertEquals(f.scheduledInMinor, 500_000);
  assertEquals(f.scheduledOutMinor, -200_000);
  // Low point of the known path is right after rent, before salary: 100k.
  const afterRent = f.points.find((p) => p.dayOffset === 5)!;
  assertEquals(afterRent.knownBalanceMinor, 100_000);
});

Deno.test("estimated path subtracts a flat daily discretionary rate", () => {
  const f = computeCashFlowForecast({
    currentBalanceMinor: 300_000,
    currency: "RWF",
    horizonDays: 10,
    scheduled: [],
    estimatedDailyDiscretionaryMinor: 5_000,
  });
  // 300k - 5k*10 = 250k estimated at horizon; known stays 300k.
  assertEquals(f.projectedEnd.knownBalanceMinor, 300_000);
  assertEquals(f.projectedEnd.estimatedBalanceMinor, 250_000);
  assertEquals(f.estimatedOutMinor, -50_000);
});

Deno.test("flags a projected dip below zero on the estimated path", () => {
  const f = computeCashFlowForecast({
    currentBalanceMinor: 120_000,
    currency: "RWF",
    horizonDays: 30,
    scheduled: [RENT], // -200k on day 5
    estimatedDailyDiscretionaryMinor: 1_000,
  });
  assert(f.mayGoNegative);
  // The low is at/after the rent day.
  assert(f.projectedLow.dayOffset >= 5);
  assert(f.projectedLow.estimatedBalanceMinor < 0);
});

Deno.test("scheduled items outside the horizon are ignored", () => {
  const f = computeCashFlowForecast({
    currentBalanceMinor: 100_000,
    currency: "RWF",
    horizonDays: 10,
    scheduled: [{ ...SALARY, dayOffset: 25 }], // beyond a 10-day horizon
    estimatedDailyDiscretionaryMinor: 0,
  });
  assertEquals(f.scheduledInMinor, 0);
  assertEquals(f.projectedEnd.knownBalanceMinor, 100_000);
});

Deno.test("basis explains every input and the disclaimer is present", () => {
  const f = computeCashFlowForecast({
    currentBalanceMinor: 300_000,
    currency: "RWF",
    horizonDays: 30,
    scheduled: [RENT, SALARY],
    estimatedDailyDiscretionaryMinor: 4_000,
  });
  assertEquals(f.basis.length, 3);
  assert(f.basis[0].toLowerCase().includes("current balance"));
  assert(f.basis[1].includes("2 scheduled items"));
  assert(f.disclaimer.toLowerCase().includes("not a guaranteed outcome"));
});
