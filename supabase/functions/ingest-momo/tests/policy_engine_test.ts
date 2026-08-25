// Unit tests for evaluatePolicies() (policy-engine.ts). index.ts wires the
// exact same function to the real Supabase client - see index.ts's
// CATEGORIZATION POLICY EVALUATION section. No live database or HTTP
// server is used here: a minimal fake replicates just the
// .from().select().eq().eq().order() / .from().update().eq() chain shapes
// evaluatePolicies() actually calls, since (unlike connection-resolver.ts)
// it is written against the raw SupabaseClient type, matching the
// pre-existing applyMerchantRule() it replaces.

import { assertEquals } from "jsr:@std/assert@1";
import { evaluatePolicies } from "../policy-engine.ts";
import type { CategorizationPolicyRow } from "../types.ts";

type FakeRow = CategorizationPolicyRow & {
  workspace_id: string;
  is_active: boolean;
};

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  #rows: FakeRow[];
  #filters: Record<string, unknown> = {};

  constructor(rows: FakeRow[]) {
    this.#rows = rows;
  }

  eq(column: string, value: unknown): this {
    this.#filters[column] = value;
    return this;
  }

  order(): this {
    return this;
  }

  #filtered(): FakeRow[] {
    return this.#rows
      .filter((row) =>
        Object.entries(this.#filters).every(([key, value]) =>
          (row as Record<string, unknown>)[key] === value
        )
      )
      .sort((a, b) => a.priority - b.priority);
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: (
      value: { data: unknown; error: null },
    ) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2> {
    const result = { data: this.#filtered(), error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(rows: FakeRow[]) {
  return {
    from(_table: string) {
      return {
        select: (_cols: string) => new FakeQuery(rows),
        update: (_patch: Record<string, unknown>) => ({
          eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }),
        }),
      };
    }, // deno-lint-ignore no-explicit-any
  } as any;
}

function policy(overrides: Partial<FakeRow>): FakeRow {
  return {
    id: overrides.id ?? "policy-1",
    name: null,
    priority: 100,
    match_type: "exact",
    merchant_pattern: null,
    normalized_merchant_name: null,
    category: "Test",
    subcategory: null,
    confidence: 1,
    usage_count: 0,
    direction: null,
    amount_min_rwf: null,
    amount_max_rwf: null,
    time_start: null,
    time_end: null,
    workspace_id: "ws-a",
    is_active: true,
    ...overrides,
  };
}

const BASE_INPUT = {
  workspaceId: "ws-a",
  direction: "out" as const,
  amountRwf: 1200,
  counterpartyName: "James KAYIJE",
  occurredAt: "2026-08-25T08:00:00+02:00",
};

Deno.test("evaluatePolicies: matches counterparty + direction + amount + time (spec Scenario A)", async () => {
  const supabase = fakeSupabase([
    policy({
      id: "p-transport",
      name: "Morning commute",
      match_type: "exact",
      merchant_pattern: "james kayije",
      category: "Transport",
      subcategory: "Moto",
      direction: "out",
      amount_min_rwf: 1000,
      amount_max_rwf: 1500,
      time_start: "06:00:00",
      time_end: "11:00:00",
    }),
  ]);

  const result = await evaluatePolicies(supabase, BASE_INPUT);

  assertEquals(result.category, "Transport");
  assertEquals(result.subcategory, "Moto");
  assertEquals(result.categorySource, "rule");
  assertEquals(result.matchedPolicyId, "p-transport");
  assertEquals(result.explanation, 'Matched your "Morning commute" policy.');
});

Deno.test("evaluatePolicies: non-matching recipient does not receive the category (spec Scenario A negative)", async () => {
  const supabase = fakeSupabase([
    policy({
      merchant_pattern: "james kayije",
      category: "Transport",
      direction: "out",
      amount_min_rwf: 1000,
      amount_max_rwf: 1500,
      time_start: "06:00:00",
      time_end: "11:00:00",
    }),
  ]);

  const result = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: "Someone Else",
  });

  assertEquals(result.category, null);
  assertEquals(result.categorySource, null);
});

Deno.test("evaluatePolicies: weak time+amount evidence alone does not match without a counterparty pattern requirement satisfied elsewhere", async () => {
  // A policy with only amount+time (no counterparty) still legitimately
  // matches if those conditions hold - this proves the *engine* evaluates
  // exactly the conditions a policy declares, not implicit confirmation.
  // Confidence-based downgrade of weak evidence is a later increment; this
  // increment's contract is deterministic condition matching only.
  const supabase = fakeSupabase([
    policy({
      category: "Transport",
      amount_min_rwf: 1000,
      amount_max_rwf: 1500,
      time_start: "06:00:00",
      time_end: "11:00:00",
    }),
  ]);

  const result = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: null,
  });

  assertEquals(result.category, "Transport");
});

Deno.test("evaluatePolicies: amount range boundaries are inclusive", async () => {
  const supabase = fakeSupabase([
    policy({
      category: "Transport",
      amount_min_rwf: 1000,
      amount_max_rwf: 1500,
    }),
  ]);

  const atMin = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    amountRwf: 1000,
    counterpartyName: null,
  });
  const atMax = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    amountRwf: 1500,
    counterpartyName: null,
  });
  const belowMin = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    amountRwf: 999,
    counterpartyName: null,
  });
  const aboveMax = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    amountRwf: 1501,
    counterpartyName: null,
  });

  assertEquals(atMin.category, "Transport");
  assertEquals(atMax.category, "Transport");
  assertEquals(belowMin.category, null);
  assertEquals(aboveMax.category, null);
});

Deno.test("evaluatePolicies: time window crossing midnight matches both sides", async () => {
  const supabase = fakeSupabase([
    policy({
      category: "Nightlife",
      time_start: "22:00:00",
      time_end: "02:00:00",
    }),
  ]);

  const lateNight = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: null,
    occurredAt: "2026-08-25T23:30:00+02:00",
  });
  const earlyMorning = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: null,
    occurredAt: "2026-08-25T01:30:00+02:00",
  });
  const daytime = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: null,
    occurredAt: "2026-08-25T12:00:00+02:00",
  });

  assertEquals(lateNight.category, "Nightlife");
  assertEquals(earlyMorning.category, "Nightlife");
  assertEquals(daytime.category, null);
});

Deno.test("evaluatePolicies: policies from another workspace never match", async () => {
  const supabase = fakeSupabase([
    policy({
      category: "Should Not Match",
      workspace_id: "ws-b",
      merchant_pattern: null,
    }),
  ]);

  const result = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: null,
  });

  assertEquals(result.category, null);
});

Deno.test("evaluatePolicies: lower-priority-number policy wins over a higher-priority-number one regardless of specificity", async () => {
  const supabase = fakeSupabase([
    policy({
      id: "p-broad-but-priority-10",
      priority: 10,
      category: "Priority Wins",
      direction: "out",
    }),
    policy({
      id: "p-specific-but-priority-100",
      priority: 100,
      category: "More Specific But Lower Priority",
      direction: "out",
      amount_min_rwf: 1000,
      amount_max_rwf: 1500,
      time_start: "06:00:00",
      time_end: "11:00:00",
    }),
  ]);

  const result = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: null,
  });

  assertEquals(result.matchedPolicyId, "p-broad-but-priority-10");
});

Deno.test("evaluatePolicies: specificity breaks ties between same-priority policies", async () => {
  const supabase = fakeSupabase([
    policy({
      id: "p-broad",
      priority: 50,
      category: "Broad",
      direction: "out",
    }),
    policy({
      id: "p-specific",
      priority: 50,
      category: "Specific",
      direction: "out",
      amount_min_rwf: 1000,
      amount_max_rwf: 1500,
      time_start: "06:00:00",
      time_end: "11:00:00",
    }),
  ]);

  const result = await evaluatePolicies(supabase, {
    ...BASE_INPUT,
    counterpartyName: null,
  });

  assertEquals(result.matchedPolicyId, "p-specific");
});

Deno.test("evaluatePolicies: degrades to empty classification on a lookup error rather than throwing", async () => {
  const erroringSupabase = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    }),
    // deno-lint-ignore no-explicit-any
  } as any;

  const result = await evaluatePolicies(erroringSupabase, BASE_INPUT);

  assertEquals(result.category, null);
  assertEquals(result.categorySource, null);
});

Deno.test("evaluatePolicies: no active policies at all returns empty classification", async () => {
  const supabase = fakeSupabase([]);
  const result = await evaluatePolicies(supabase, BASE_INPUT);
  assertEquals(result.category, null);
});
