import { assertEquals } from "jsr:@std/assert@1";
import {
  aggregateOutflowsByAllocation,
  CategoryMappingWindow,
  MappedOutflow,
  SplitAllocation,
} from "./budget-math.ts";

function outflow(overrides: Partial<MappedOutflow> = {}): MappedOutflow {
  return {
    transactionId: crypto.randomUUID(),
    category: "Food",
    effectMinor: 1000n,
    occurredAtDateKey: "2026-08-25",
    ...overrides,
  };
}

const FOOD_MAPPING: CategoryMappingWindow = {
  category: "Food",
  allocationType: "ESSENTIALS",
  effectiveFrom: "2026-01-01",
  effectiveUntil: null,
};

Deno.test("aggregateOutflowsByAllocation: no outflows produces all-zero totals", () => {
  const result = aggregateOutflowsByAllocation([], [], []);
  assertEquals(result.totalsByAllocation, {
    ESSENTIALS: 0n,
    INVESTING: 0n,
    EMERGENCY: 0n,
    WANTS: 0n,
  });
  assertEquals(result.unmappedCount, 0);
  assertEquals(result.uncategorizedCount, 0);
});

Deno.test("aggregateOutflowsByAllocation: a mapped category routes its full effect to that allocation", () => {
  const result = aggregateOutflowsByAllocation(
    [outflow({ category: "Food", effectMinor: 5000n })],
    [],
    [FOOD_MAPPING],
  );
  assertEquals(result.totalsByAllocation.ESSENTIALS, 5000n);
});

Deno.test("aggregateOutflowsByAllocation: null category counts as uncategorized, never guessed as mapped", () => {
  const result = aggregateOutflowsByAllocation(
    [outflow({ category: null, effectMinor: 2000n })],
    [],
    [FOOD_MAPPING],
  );
  assertEquals(result.uncategorizedMinor, 2000n);
  assertEquals(result.uncategorizedCount, 1);
  assertEquals(result.totalsByAllocation.ESSENTIALS, 0n);
});

Deno.test("aggregateOutflowsByAllocation: a category with no currently-effective mapping counts as unmapped", () => {
  const result = aggregateOutflowsByAllocation(
    [outflow({ category: "Transport", effectMinor: 3000n })],
    [],
    [FOOD_MAPPING],
  );
  assertEquals(result.unmappedMinor, 3000n);
  assertEquals(result.unmappedCount, 1);
});

Deno.test("aggregateOutflowsByAllocation: a split transaction is governed entirely by its splits, ignoring its own category", () => {
  const txnId = "11111111-1111-1111-1111-111111111111";
  const splits: SplitAllocation[] = [
    { transactionId: txnId, allocationType: "ESSENTIALS", amountMinor: 3000n },
    { transactionId: txnId, allocationType: "WANTS", amountMinor: 2000n },
  ];
  const result = aggregateOutflowsByAllocation(
    [outflow({ transactionId: txnId, category: "Food", effectMinor: 5000n })],
    splits,
    [FOOD_MAPPING],
  );
  assertEquals(result.totalsByAllocation.ESSENTIALS, 3000n);
  assertEquals(result.totalsByAllocation.WANTS, 2000n);
  // The whole-transaction category-mapping path is never taken once splits exist.
  assertEquals(result.uncategorizedCount, 0);
  assertEquals(result.unmappedCount, 0);
});

Deno.test("aggregateOutflowsByAllocation: mapping lookup is effective-dated per transaction, not the caller's 'today'", () => {
  const oldMapping: CategoryMappingWindow = {
    category: "Food",
    allocationType: "WANTS",
    effectiveFrom: "2026-01-01",
    effectiveUntil: "2026-06-30",
  };
  const newMapping: CategoryMappingWindow = {
    category: "Food",
    allocationType: "ESSENTIALS",
    effectiveFrom: "2026-07-01",
    effectiveUntil: null,
  };

  const beforeRemap = aggregateOutflowsByAllocation(
    [outflow({ occurredAtDateKey: "2026-03-01", effectMinor: 1000n })],
    [],
    [oldMapping, newMapping],
  );
  assertEquals(beforeRemap.totalsByAllocation.WANTS, 1000n);
  assertEquals(beforeRemap.totalsByAllocation.ESSENTIALS, 0n);

  const afterRemap = aggregateOutflowsByAllocation(
    [outflow({ occurredAtDateKey: "2026-08-01", effectMinor: 1000n })],
    [],
    [oldMapping, newMapping],
  );
  assertEquals(afterRemap.totalsByAllocation.ESSENTIALS, 1000n);
  assertEquals(afterRemap.totalsByAllocation.WANTS, 0n);
});

Deno.test("aggregateOutflowsByAllocation: multiple outflows across categories accumulate correctly", () => {
  const result = aggregateOutflowsByAllocation(
    [
      outflow({ category: "Food", effectMinor: 3000n }),
      outflow({ category: "Food", effectMinor: 2000n }),
      outflow({ category: null, effectMinor: 500n }),
      outflow({ category: "Unknown", effectMinor: 700n }),
    ],
    [],
    [FOOD_MAPPING],
  );
  assertEquals(result.totalsByAllocation.ESSENTIALS, 5000n);
  assertEquals(result.uncategorizedMinor, 500n);
  assertEquals(result.unmappedMinor, 700n);
});
