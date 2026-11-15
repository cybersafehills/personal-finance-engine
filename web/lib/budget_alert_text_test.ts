import { assertEquals } from "jsr:@std/assert@1";

import type { BudgetAlert } from "./budget-math.ts";
import { budgetAlertMessage } from "./budget-alert-text.ts";
import { formatMoney } from "./money.ts";
import { toMobileBudget, type ActualsInput } from "./mobile-budgets.ts";

const alerts: BudgetAlert[] = [
  { id: "a1", kind: "allocation_watch", severity: "info", allocationType: "WANTS", percentConsumed: 76.4 },
  { id: "a2", kind: "allocation_exceeded", severity: "critical", allocationType: "ESSENTIALS", actualMinor: 120000n, targetMinor: 100000n },
  { id: "a3", kind: "uncategorized_spending", severity: "warning", count: 1, totalMinor: 5000n },
];

Deno.test("alert wording is the one sentence set both clients share", () => {
  assertEquals(budgetAlertMessage(alerts[0], "RWF"), "Wants has used 76% of its target.");
  assertEquals(
    budgetAlertMessage(alerts[1], "RWF"),
    `Essentials exceeded its target: ${formatMoney(120000n, "RWF")} of ${formatMoney(100000n, "RWF")}.`,
  );
  assertEquals(
    budgetAlertMessage(alerts[2], "RWF"),
    `1 uncategorized transaction (${formatMoney(5000n, "RWF")}) aren't counted in any allocation.`,
  );
});

const actuals = (over: Partial<ActualsInput> = {}): ActualsInput => ({
  allocations: [
    { allocationType: "ESSENTIALS", targetMinor: 100000, actualMinor: 120000, remainingMinor: -20000, percentConsumed: 120, projectedMinor: 150000, status: "exceeded" },
  ],
  actualIncomeMinor: 300000,
  unmappedMinor: 0,
  unmappedCount: 0,
  uncategorizedMinor: 5000,
  uncategorizedCount: 1,
  elapsedFraction: 0.5,
  alerts,
  ...over,
});

const budget = { id: "b1", name: "November", currency: "RWF", period_start: "2026-11-01", period_end: "2026-11-30" };

Deno.test("toMobileBudget is JSON-safe (no bigint) and carries labels and rendered alerts", () => {
  const out = toMobileBudget(budget, actuals())!;
  const json = JSON.parse(JSON.stringify(out)); // would throw on a bigint
  assertEquals(json.allocations[0].label, "Essentials");
  assertEquals(json.alerts.length, 3);
  assertEquals(json.alerts[0], { id: "a1", severity: "info", message: "Wants has used 76% of its target." });
  assertEquals(json.periodStart, "2026-11-01");
  assertEquals(json.uncategorizedCount, 1);
});

Deno.test("a budget in an unsupported currency is left out, never mislabelled", () => {
  assertEquals(toMobileBudget({ ...budget, currency: "JPY" }, actuals()), null);
});
