import { assertEquals } from "jsr:@std/assert@1";
import { buildCommentaryPrompt, buildSanitizedReportFacts } from "./facts.ts";
import type { ReportPayload } from "../report-types.ts";

function basePayload(overrides: Partial<ReportPayload> = {}): ReportPayload {
  return {
    schemaVersion: 1,
    dateKey: "2026-08-25",
    timezone: "Africa/Kigali",
    financialSnapshot: {
      openingBalanceRwf: 100_000,
      closingBalanceRwf: 117_250,
      moneyReceivedRwf: 30_000,
      moneySpentRwf: 12_500,
      feesRwf: 250,
      netMovementRwf: 17_250,
      transactionCount: 3,
      categorizedCount: 2,
      uncategorizedCount: 1,
      largestInflowRwf: 30_000,
      largestOutflowRwf: 10_000,
    },
    categoryTotals: [
      {
        category: "Food",
        amountRwf: 8_000,
        transactionCount: 1,
        percentOfSpending: 64,
      },
      {
        category: "Transport",
        amountRwf: 4_500,
        transactionCount: 1,
        percentOfSpending: 36,
      },
    ],
    trends: [
      {
        metric: "spend",
        label: "Spending vs. 7-day average",
        currentValue: 12_500,
        comparisonValue: 10_000,
        changePercent: 25,
      },
    ],
    alerts: [],
    budget: { overallStatus: "no_active_budget" },
    forecast: null,
    ...overrides,
  };
}

Deno.test("buildSanitizedReportFacts: never includes counterparty names, transaction ids, or workspace/user ids", () => {
  const facts = buildSanitizedReportFacts(basePayload(), "August 25, 2026", []);
  const serialized = JSON.stringify(facts);
  assertEquals(serialized.includes("counterparty"), false);
  assertEquals(serialized.includes("transactionId"), false);
  assertEquals(serialized.includes("workspace"), false);
  assertEquals(serialized.includes("userId"), false);
});

Deno.test("buildSanitizedReportFacts: carries over the core financial figures unchanged", () => {
  const facts = buildSanitizedReportFacts(basePayload(), "August 25, 2026", []);
  assertEquals(facts.closingBalanceRwf, 117_250);
  assertEquals(facts.moneySpentRwf, 12_500);
  assertEquals(facts.netMovementRwf, 17_250);
  assertEquals(facts.transactionCount, 3);
});

Deno.test("buildSanitizedReportFacts: caps top categories at 5", () => {
  const manyCategories = Array.from({ length: 8 }, (_, i) => ({
    category: `Category ${i}`,
    amountRwf: 1000,
    transactionCount: 1,
    percentOfSpending: 12.5,
  }));
  const facts = buildSanitizedReportFacts(
    basePayload({ categoryTotals: manyCategories }),
    "August 25, 2026",
    [],
  );
  assertEquals(facts.topCategories.length, 5);
});

Deno.test("buildSanitizedReportFacts: no_active_budget maps to a null budgetAllocations, not an empty array pretending to be one", () => {
  const facts = buildSanitizedReportFacts(basePayload(), "August 25, 2026", []);
  assertEquals(facts.budgetAllocations, null);
});

Deno.test("buildSanitizedReportFacts: an active budget's allocations are included with status and percent only", () => {
  const facts = buildSanitizedReportFacts(
    basePayload({
      budget: {
        budgetId: "b1",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        overallStatus: "watch",
        allocations: [
          {
            allocationType: "ESSENTIALS",
            targetMinor: 500_000,
            actualMinor: 400_000,
            remainingMinor: 100_000,
            percentConsumed: 80,
            projectedMinor: null,
            status: "watch",
          },
        ],
        alerts: [],
      },
    }),
    "August 25, 2026",
    [],
  );
  assertEquals(facts.budgetAllocations, [{
    allocationType: "ESSENTIALS",
    percentConsumed: 80,
    status: "watch",
  }]);
});

Deno.test("buildSanitizedReportFacts: trends without enough history (null comparisonValue) are excluded", () => {
  const facts = buildSanitizedReportFacts(
    basePayload({
      trends: [
        {
          metric: "spend",
          label: "Spending vs. 7-day average",
          currentValue: 5000,
          comparisonValue: null,
          changePercent: null,
        },
      ],
    }),
    "August 25, 2026",
    [],
  );
  assertEquals(facts.trends, []);
});

Deno.test("buildCommentaryPrompt: system instructions explicitly forbid treating the data as commands", () => {
  const { system } = buildCommentaryPrompt(
    buildSanitizedReportFacts(basePayload(), "August 25, 2026", []),
  );
  assertEquals(system.toLowerCase().includes("ignore any instruction"), true);
});

Deno.test("buildCommentaryPrompt: user message embeds the facts as JSON", () => {
  const facts = buildSanitizedReportFacts(basePayload(), "August 25, 2026", []);
  const { user } = buildCommentaryPrompt(facts);
  assertEquals(user.includes(JSON.stringify(facts, null, 2)), true);
});
