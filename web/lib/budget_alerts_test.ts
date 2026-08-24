import { assertEquals } from "jsr:@std/assert@1";
import { BudgetAlert, BudgetAlertInput, computeBudgetAlerts } from "./budget-math.ts";

function baseInput(overrides: Partial<BudgetAlertInput> = {}): BudgetAlertInput {
  return {
    allocations: [
      { allocationType: "ESSENTIALS", actualMinor: 100_000n, targetMinor: 500_000n, status: "healthy" },
      { allocationType: "INVESTING", actualMinor: 50_000n, targetMinor: 150_000n, status: "healthy" },
      { allocationType: "EMERGENCY", actualMinor: 0n, targetMinor: 50_000n, status: "healthy" },
      { allocationType: "WANTS", actualMinor: 100_000n, targetMinor: 300_000n, status: "healthy" },
    ],
    unmappedCount: 0,
    unmappedMinor: 0n,
    uncategorizedCount: 0,
    uncategorizedMinor: 0n,
    budgetedIncomeMinor: 1_000_000n,
    actualIncomeMinor: 1_000_000n,
    elapsedFraction: 0.5,
    ...overrides,
  };
}

function findKind(alerts: BudgetAlert[], kind: BudgetAlert["kind"]) {
  return alerts.find((a) => a.kind === kind);
}

Deno.test("computeBudgetAlerts: no alerts when everything is healthy and on-budget", () => {
  const alerts = computeBudgetAlerts(baseInput());
  assertEquals(alerts.length, 0);
});

Deno.test("computeBudgetAlerts: watch status produces an info-severity allocation_watch alert", () => {
  const alerts = computeBudgetAlerts(
    baseInput({
      allocations: [
        { allocationType: "WANTS", actualMinor: 240_000n, targetMinor: 300_000n, status: "watch" },
      ],
    }),
  );
  const alert = findKind(alerts, "allocation_watch");
  assertEquals(alert?.severity, "info");
  assertEquals(alert?.id, "allocation-watch-WANTS");
});

Deno.test("computeBudgetAlerts: at_risk status produces a warning-severity allocation_at_risk alert", () => {
  const alerts = computeBudgetAlerts(
    baseInput({
      allocations: [
        { allocationType: "WANTS", actualMinor: 280_000n, targetMinor: 300_000n, status: "at_risk" },
      ],
    }),
  );
  const alert = findKind(alerts, "allocation_at_risk");
  assertEquals(alert?.severity, "warning");
});

Deno.test("computeBudgetAlerts: exceeded status produces a critical-severity allocation_exceeded alert with amounts", () => {
  const alerts = computeBudgetAlerts(
    baseInput({
      allocations: [
        { allocationType: "WANTS", actualMinor: 350_000n, targetMinor: 300_000n, status: "exceeded" },
      ],
    }),
  );
  const alert = findKind(alerts, "allocation_exceeded");
  assertEquals(alert?.severity, "critical");
  if (alert?.kind === "allocation_exceeded") {
    assertEquals(alert.actualMinor, 350_000n);
    assertEquals(alert.targetMinor, 300_000n);
  }
});

Deno.test("computeBudgetAlerts: insufficient_data status produces no alert (not a problem, just no data yet)", () => {
  const alerts = computeBudgetAlerts(
    baseInput({
      allocations: [
        { allocationType: "WANTS", actualMinor: 0n, targetMinor: 0n, status: "insufficient_data" },
      ],
    }),
  );
  assertEquals(alerts.length, 0);
});

Deno.test("computeBudgetAlerts: unmapped spending produces one alert regardless of how many transactions", () => {
  const alerts = computeBudgetAlerts(
    baseInput({ unmappedCount: 3, unmappedMinor: 45_000n }),
  );
  const alert = findKind(alerts, "unmapped_spending");
  if (alert?.kind === "unmapped_spending") {
    assertEquals(alert.count, 3);
    assertEquals(alert.totalMinor, 45_000n);
  } else {
    throw new Error("expected unmapped_spending alert");
  }
});

Deno.test("computeBudgetAlerts: uncategorized spending produces its own alert, distinct from unmapped", () => {
  const alerts = computeBudgetAlerts(
    baseInput({ uncategorizedCount: 2, uncategorizedMinor: 10_000n }),
  );
  assertEquals(alerts.length, 1);
  assertEquals(alerts[0].kind, "uncategorized_spending");
});

Deno.test("computeBudgetAlerts: income shortfall is suppressed before half the period has elapsed", () => {
  const alerts = computeBudgetAlerts(
    baseInput({
      actualIncomeMinor: 500_000n, // 50% of budgeted - well past the threshold
      elapsedFraction: 0.2,
    }),
  );
  assertEquals(findKind(alerts, "income_below_budget"), undefined);
});

Deno.test("computeBudgetAlerts: income shortfall is suppressed when elapsedFraction is null (budget not active / outside period)", () => {
  const alerts = computeBudgetAlerts(
    baseInput({ actualIncomeMinor: 500_000n, elapsedFraction: null }),
  );
  assertEquals(findKind(alerts, "income_below_budget"), undefined);
});

Deno.test("computeBudgetAlerts: income shortfall fires once elapsed >= 50% and shortfall >= 10%", () => {
  const alerts = computeBudgetAlerts(
    baseInput({ actualIncomeMinor: 850_000n, elapsedFraction: 0.6 }), // 15% shortfall
  );
  const alert = findKind(alerts, "income_below_budget");
  if (alert?.kind === "income_below_budget") {
    assertEquals(alert.budgetedMinor, 1_000_000n);
    assertEquals(alert.actualMinor, 850_000n);
    assertEquals(Math.round(alert.shortfallPercent), 15);
  } else {
    throw new Error("expected income_below_budget alert");
  }
});

Deno.test("computeBudgetAlerts: income shortfall does not fire below the 10% threshold", () => {
  const alerts = computeBudgetAlerts(
    baseInput({ actualIncomeMinor: 950_000n, elapsedFraction: 0.6 }), // 5% shortfall
  );
  assertEquals(findKind(alerts, "income_below_budget"), undefined);
});

Deno.test("computeBudgetAlerts: income above or exactly at budget never triggers a shortfall alert", () => {
  const alerts = computeBudgetAlerts(
    baseInput({ actualIncomeMinor: 1_200_000n, elapsedFraction: 0.9 }),
  );
  assertEquals(findKind(alerts, "income_below_budget"), undefined);
});

Deno.test("computeBudgetAlerts: multiple simultaneous conditions all produce distinct alerts", () => {
  const alerts = computeBudgetAlerts(
    baseInput({
      allocations: [
        { allocationType: "WANTS", actualMinor: 350_000n, targetMinor: 300_000n, status: "exceeded" },
        { allocationType: "ESSENTIALS", actualMinor: 260_000n, targetMinor: 500_000n, status: "watch" },
      ],
      unmappedCount: 1,
      unmappedMinor: 5_000n,
      actualIncomeMinor: 800_000n,
      elapsedFraction: 0.8,
    }),
  );
  const kinds = alerts.map((a) => a.kind).sort();
  assertEquals(kinds, [
    "allocation_exceeded",
    "allocation_watch",
    "income_below_budget",
    "unmapped_spending",
  ]);
});
