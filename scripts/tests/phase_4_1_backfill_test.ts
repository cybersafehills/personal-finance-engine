// Integration + unit tests for the Phase 4.1 accounting backfill tool.
//
// The pure-function tests (classifyRow edge cases) run standalone. The
// integration tests require an already-running, already-seeded PostgreSQL
// instance - see scripts/tests/run_backfill_tests.sh, which spawns a
// disposable PG 17 cluster, applies the full migration chain, seeds
// representative transaction shapes, and invokes this file via
// `deno test` with PGHOST/PGPORT/PGUSER/PGDATABASE already exported. Do
// not run this file directly against any other database.

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.9";
import {
  buildPlan,
  classifyRow,
  executePlan,
  type Plan,
  rollbackResultLog,
  type TransactionRow,
} from "../phase-4-1-accounting-backfill.ts";

// ===========================================================================
// Pure-function tests: classifyRow edge cases unreachable via the seeded DB
// (structurally prevented by CHECK constraints there - tested directly here
// against synthetic in-memory rows instead).
// ===========================================================================

function baseRow(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: "test-id",
    transaction_type: "send_money",
    direction: "out",
    status: "success",
    amount_rwf: 1000,
    fee_rwf: 0,
    net_effect_rwf: -1000,
    principal_effect_rwf: null,
    fee_effect_rwf: null,
    settlement_state: null,
    affects_balance: null,
    effect_reason: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

Deno.test("classifyRow: negative amount is malformed, never reaches computeAccountingEffect", () => {
  const result = classifyRow(baseRow({ amount_rwf: -500 }));
  assertEquals(result.category, "malformed_negative_amount");
  assertEquals(result.effect, null);
});

Deno.test("classifyRow: negative fee is malformed", () => {
  const result = classifyRow(baseRow({ fee_rwf: -1 }));
  assertEquals(result.category, "malformed_negative_amount");
});

Deno.test("classifyRow: unrecognized direction is flagged, not guessed", () => {
  const result = classifyRow(baseRow({ direction: "sideways" }));
  assertEquals(result.category, "unrecognized_status_or_direction");
});

Deno.test("classifyRow: unrecognized status is flagged, not guessed", () => {
  const result = classifyRow(baseRow({ status: "voided" }));
  assertEquals(result.category, "unrecognized_status_or_direction");
});

Deno.test("classifyRow: partially populated accounting columns is contradictory", () => {
  const result = classifyRow(
    baseRow({ principal_effect_rwf: -1000, fee_effect_rwf: null }),
  );
  assertEquals(result.category, "contradictory_partial_state");
});

Deno.test("classifyRow: fully populated accounting columns is already_processed", () => {
  const result = classifyRow(
    baseRow({
      principal_effect_rwf: -1000,
      fee_effect_rwf: 0,
      settlement_state: "settled",
      affects_balance: true,
      effect_reason: "settled_outgoing_no_fee",
    }),
  );
  assertEquals(result.category, "already_processed");
});

Deno.test("classifyRow: incoming transfer with nonzero fee is excluded before computeAccountingEffect", () => {
  const result = classifyRow(
    baseRow({
      direction: "in",
      amount_rwf: 7000,
      fee_rwf: 50,
      net_effect_rwf: 7000,
    }),
  );
  assertEquals(result.category, "unsupported_incoming_with_fee");
  assertEquals(result.effect, null);
});

Deno.test("classifyRow: net_effect_rwf mismatch with computeAccountingEffect is contradictory (defense in depth)", () => {
  const result = classifyRow(baseRow({ net_effect_rwf: -999999 }));
  assertEquals(result.category, "contradictory_partial_state");
});

Deno.test("classifyRow: valid settled-outgoing-with-fee row is eligible with correct effect", () => {
  const result = classifyRow(
    baseRow({ amount_rwf: 5000, fee_rwf: 100, net_effect_rwf: -5100 }),
  );
  assertEquals(result.category, "eligible");
  assertExists(result.effect);
  assertEquals(result.effect!.principal_effect_rwf, -5000);
  assertEquals(result.effect!.fee_effect_rwf, -100);
  assertEquals(result.effect!.net_effect_rwf, -5100);
  assertEquals(result.effect!.settlement_state, "settled");
  assertEquals(result.effect!.affects_balance, true);
});

// ===========================================================================
// Integration tests against the seeded disposable database.
// ===========================================================================

const SEED_IDS = {
  A: "00000000-0000-0000-0000-00000000000a",
  B: "00000000-0000-0000-0000-00000000000b",
  C: "00000000-0000-0000-0000-00000000000c",
  D: "00000000-0000-0000-0000-00000000000d",
  E: "00000000-0000-0000-0000-00000000000e",
  F: "00000000-0000-0000-0000-00000000000f",
  G: "00000000-0000-0000-0000-000000000010",
  H: "00000000-0000-0000-0000-000000000011",
};

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    throw new Error(
      `${name} must be set - run via scripts/tests/run_backfill_tests.sh, not directly.`,
    );
  }
  return v;
}

function connectTest(): postgres.Sql {
  return postgres({
    host: requireEnv("PGHOST"),
    port: Number(requireEnv("PGPORT")),
    username: requireEnv("PGUSER"),
    database: requireEnv("PGDATABASE"),
    max: 1,
  });
}

async function fetchAllTransactions(
  sql: postgres.Sql,
): Promise<TransactionRow[]> {
  return await sql<TransactionRow[]>`
    select id, transaction_type, direction, status, amount_rwf, fee_rwf,
           net_effect_rwf, principal_effect_rwf, fee_effect_rwf,
           settlement_state, affects_balance, effect_reason, created_at
    from transactions
    order by created_at, id
  `;
}

Deno.test("integration: buildPlan classifies the seeded fixture set correctly", async () => {
  const sql = connectTest();
  try {
    const rows = await fetchAllTransactions(sql);
    const plan = buildPlan(rows, "test-host", "pfe_backfill_test");

    assertEquals(plan.total_transactions, 8);
    assertEquals(plan.already_processed_count, 1); // D
    assertEquals(plan.eligible_count, 6); // A, B, C, F, G, H
    assertEquals(plan.excluded["unsupported_incoming_with_fee"], 1); // E
    assertEquals(plan.excluded_ids["unsupported_incoming_with_fee"], [
      SEED_IDS.E,
    ]);

    const byId = new Map(plan.entries.map((e) => [e.id, e]));

    assertEquals(
      byId.get(SEED_IDS.A)?.expected_effect.principal_effect_rwf,
      -5000,
    );
    assertEquals(byId.get(SEED_IDS.A)?.expected_effect.fee_effect_rwf, -100);
    assertEquals(
      byId.get(SEED_IDS.A)?.expected_effect.settlement_state,
      "settled",
    );

    assertEquals(
      byId.get(SEED_IDS.B)?.expected_effect.principal_effect_rwf,
      10000,
    );
    assertEquals(byId.get(SEED_IDS.B)?.expected_effect.affects_balance, true);

    assertEquals(byId.get(SEED_IDS.C)?.expected_effect.principal_effect_rwf, 0);
    assertEquals(
      byId.get(SEED_IDS.C)?.expected_effect.settlement_state,
      "failed",
    );
    assertEquals(byId.get(SEED_IDS.C)?.expected_effect.affects_balance, false);

    assertEquals(
      byId.get(SEED_IDS.F)?.expected_effect.settlement_state,
      "unknown",
    );
    assertEquals(byId.get(SEED_IDS.F)?.expected_effect.affects_balance, false);

    assertEquals(byId.has(SEED_IDS.D), false); // already processed, not in entries
    assertEquals(byId.has(SEED_IDS.E), false); // excluded, not in entries
  } finally {
    await sql.end();
  }
});

Deno.test("integration: execute writes only eligible rows, detects a concurrent change via compare-and-set, D and E are never touched", async () => {
  const sql = connectTest();
  try {
    const rows = await fetchAllTransactions(sql);
    const plan = buildPlan(rows, "test-host", "pfe_backfill_test");

    // Simulate a concurrent state change to row G between plan generation
    // and execution - its amount_rwf changes from what the plan expects.
    await sql`update transactions set amount_rwf = 9999 where id = ${SEED_IDS.G}`;

    const resultLog = await executePlan(
      sql,
      plan,
      "test-host",
      "pfe_backfill_test",
    );
    const byId = new Map(resultLog.results.map((r) => [r.id, r]));

    assertEquals(byId.get(SEED_IDS.A)?.outcome, "updated");
    assertEquals(byId.get(SEED_IDS.B)?.outcome, "updated");
    assertEquals(byId.get(SEED_IDS.C)?.outcome, "updated");
    assertEquals(byId.get(SEED_IDS.F)?.outcome, "updated");
    assertEquals(byId.get(SEED_IDS.H)?.outcome, "updated");
    assertEquals(byId.get(SEED_IDS.G)?.outcome, "cas_failed_unexpected_state");

    // D and E were never in the plan's entries at all, so they cannot
    // appear in the result log - confirm directly against the database
    // that neither was touched.
    const [dRow] = await sql<{ principal_effect_rwf: number | null }[]>`
      select principal_effect_rwf from transactions where id = ${SEED_IDS.D}
    `;
    assertEquals(
      dRow.principal_effect_rwf === null
        ? null
        : Number(dRow.principal_effect_rwf),
      -3000,
    ); // unchanged from seed

    const [eRow] = await sql<{ principal_effect_rwf: number | null }[]>`
      select principal_effect_rwf from transactions where id = ${SEED_IDS.E}
    `;
    assertEquals(eRow.principal_effect_rwf, null); // still unprocessed - excluded, never written

    // G's amount_rwf was never reverted by the tool - it only refused to
    // write the accounting columns.
    const [gRow] = await sql<
      { amount_rwf: number; principal_effect_rwf: number | null }[]
    >`
      select amount_rwf, principal_effect_rwf from transactions where id = ${SEED_IDS.G}
    `;
    assertEquals(Number(gRow.amount_rwf), 9999);
    assertEquals(gRow.principal_effect_rwf, null);

    // ---- Idempotent rerun: re-executing the SAME (now stale) plan a
    // second time must not error and must not double-apply anything. ----
    const rerunLog = await executePlan(
      sql,
      plan,
      "test-host",
      "pfe_backfill_test",
    );
    const rerunById = new Map(rerunLog.results.map((r) => [r.id, r]));
    assertEquals(
      rerunById.get(SEED_IDS.A)?.outcome,
      "already_applied_matches_plan",
    );
    assertEquals(
      rerunById.get(SEED_IDS.H)?.outcome,
      "already_applied_matches_plan",
    );
    // G still conflicts the same way on rerun, since its amount_rwf is
    // still 9999, not what the stale plan expects.
    assertEquals(
      rerunById.get(SEED_IDS.G)?.outcome,
      "cas_failed_unexpected_state",
    );

    // A fresh plan built from current state now shows A/B/C/F/H as
    // already_processed and G still eligible (never corrupted, never
    // silently forced through).
    const freshRows = await fetchAllTransactions(sql);
    const freshPlan: Plan = buildPlan(
      freshRows,
      "test-host",
      "pfe_backfill_test",
    );
    assertEquals(freshPlan.already_processed_count, 6); // A, B, C, D, F, H
    assertEquals(freshPlan.eligible_count, 1); // G only
    assertEquals(freshPlan.entries[0]?.id, SEED_IDS.G);

    // ---- Rollback: revert exactly what this execute run wrote. ----
    const rollbackOutcomes = await rollbackResultLog(sql, resultLog);
    const rollbackById = new Map(
      rollbackOutcomes.map((o) => [o.id, o.outcome]),
    );
    assertEquals(rollbackById.get(SEED_IDS.A), "reverted");
    assertEquals(rollbackById.get(SEED_IDS.B), "reverted");
    assertEquals(rollbackById.get(SEED_IDS.C), "reverted");
    assertEquals(rollbackById.get(SEED_IDS.F), "reverted");
    assertEquals(rollbackById.get(SEED_IDS.H), "reverted");
    assertEquals(rollbackById.get(SEED_IDS.G), "skipped_not_updated");

    const [aAfterRollback] = await sql<
      { principal_effect_rwf: number | null; settlement_state: string | null }[]
    >`
      select principal_effect_rwf, settlement_state from transactions where id = ${SEED_IDS.A}
    `;
    assertEquals(aAfterRollback.principal_effect_rwf, null);
    assertEquals(aAfterRollback.settlement_state, null);

    // D (never in this run) must remain fully processed after rollback -
    // rollback only ever targets rows recorded in the given result log.
    const [dAfterRollback] = await sql<
      { principal_effect_rwf: number | null }[]
    >`
      select principal_effect_rwf from transactions where id = ${SEED_IDS.D}
    `;
    assertEquals(
      dAfterRollback.principal_effect_rwf === null
        ? null
        : Number(dAfterRollback.principal_effect_rwf),
      -3000,
    );

    // Full reversibility: a fresh plan now shows A/B/C/F/H eligible again.
    const postRollbackRows = await fetchAllTransactions(sql);
    const postRollbackPlan = buildPlan(
      postRollbackRows,
      "test-host",
      "pfe_backfill_test",
    );
    assertEquals(postRollbackPlan.already_processed_count, 1); // D only
  } finally {
    await sql.end();
  }
});
