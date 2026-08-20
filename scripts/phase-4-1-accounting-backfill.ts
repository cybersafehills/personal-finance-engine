// Phase 4.1 accounting backfill tool.
//
// ONE-TIME, MANUALLY-INVOKED, REPOSITORY-CONTROLLED SCRIPT. Not an Edge
// Function, not deployed anywhere, never runs automatically. Populates the
// five Phase 3 accounting-effect columns (principal_effect_rwf,
// fee_effect_rwf, settlement_state, affects_balance, effect_reason) for
// historical/unprocessed rows in `transactions`, using ONLY the canonical
// computeAccountingEffect() from ../supabase/functions/_shared/accounting.ts
// - this file never reimplements accounting logic.
//
// Talks to Postgres directly (not via PostgREST/supabase-js), because a
// one-off maintenance tool has no reason to go through the REST layer, and
// direct SQL is what lets every write be a genuine single-statement
// compare-and-set. Connection is via standard PG* environment variables
// (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) or DATABASE_URL - exactly
// like tests/run_migration_tests.sh's "external" mode - never hardcoded,
// never logged.
//
// THREE MODES, each requiring an explicit flag - there is no default mode
// that writes anything:
//
//   deno run -A scripts/phase-4-1-accounting-backfill.ts plan
//     Read-only. Classifies every transaction, computes the intended
//     accounting effect for every eligible row via computeAccountingEffect(),
//     validates it against the same invariants the database enforces, and
//     writes a plan file to scripts/backfill-runs/. Never issues a write.
//
//   deno run -A scripts/phase-4-1-accounting-backfill.ts execute --plan <path> --confirm
//     Reads a previously-generated plan file and, for each eligible row in
//     it, issues ONE parameterized compare-and-set UPDATE. --confirm is
//     mandatory and must be typed explicitly - this is the only mode that
//     writes to the database. Writes a result-log file recording, per row,
//     the before-state (for rollback) and the outcome.
//
//   deno run -A scripts/phase-4-1-accounting-backfill.ts rollback --result-log <path> --confirm
//     Reads a previous execute run's result-log file and reverts ONLY the
//     rows that run actually updated, each via its own compare-and-set
//     (only reverting if the row still matches exactly what that run wrote).
//     Never a broad UPDATE ... WHERE settlement_state IS NOT NULL or
//     similar.
//
// This file has not been run against the linked production project as of
// Phase 4.1 discovery - see PHASE_4_1_BACKFILL_READINESS_REPORT.md.

import postgres from "npm:postgres@3.4.9";
import {
  computeAccountingEffect,
} from "../supabase/functions/_shared/accounting.ts";
import type {
  AccountingEffect,
  TransactionDirection,
  TransactionStatus,
} from "../supabase/functions/_shared/types.ts";

// ===========================================================================
// Types
// ===========================================================================

export type TransactionRow = {
  id: string;
  transaction_type: string;
  direction: string;
  status: string;
  amount_rwf: string | number; // bigint comes back as string from postgres.js
  fee_rwf: string | number;
  net_effect_rwf: string | number;
  principal_effect_rwf: string | number | null;
  fee_effect_rwf: string | number | null;
  settlement_state: string | null;
  affects_balance: boolean | null;
  effect_reason: string | null;
  created_at: string;
};

export type EligibilityCategory =
  | "eligible"
  | "already_processed"
  | "contradictory_partial_state"
  | "malformed_negative_amount"
  | "unsupported_incoming_with_fee"
  | "unrecognized_status_or_direction";

export type Classification = {
  row: TransactionRow;
  category: EligibilityCategory;
  reason: string;
  effect: AccountingEffect | null;
};

export type PlanEntry = {
  id: string;
  transaction_type: string;
  direction: string;
  status: string;
  amount_rwf: number;
  fee_rwf: number;
  net_effect_rwf: number;
  expected_effect: AccountingEffect;
};

export type Plan = {
  run_id: string;
  generated_at: string;
  mode: "plan";
  source_host: string;
  source_database: string;
  total_transactions: number;
  eligible_count: number;
  already_processed_count: number;
  excluded: Record<string, number>;
  excluded_ids: Record<string, string[]>;
  entries: PlanEntry[];
};

export type ExecuteResultRow = {
  id: string;
  outcome:
    | "updated"
    | "already_applied_matches_plan"
    | "cas_failed_unexpected_state"
    | "error";
  before: {
    principal_effect_rwf: number | null;
    fee_effect_rwf: number | null;
    settlement_state: string | null;
    affects_balance: boolean | null;
    effect_reason: string | null;
  } | null;
  after: AccountingEffect | null;
  detail?: string;
};

export type ExecuteResultLog = {
  run_id: string;
  plan_run_id: string;
  executed_at: string;
  mode: "execute";
  source_host: string;
  source_database: string;
  results: ExecuteResultRow[];
  summary: Record<string, number>;
};

// ===========================================================================
// Eligibility classification
// ===========================================================================

const VALID_DIRECTIONS: readonly string[] = ["in", "out", "neutral"];
const VALID_STATUSES: readonly string[] = [
  "success",
  "failed",
  "reversed",
  "pending",
  "unknown",
];

/**
 * Classifies a single transaction row and, for eligible rows, computes its
 * accounting effect via the canonical computeAccountingEffect(). Never
 * throws for a well-formed row shape - unclassifiable/dangerous input is
 * returned as a non-eligible category with a reason, never silently
 * defaulted.
 */
export function classifyRow(row: TransactionRow): Classification {
  const principalSet = row.principal_effect_rwf !== null;
  const feeSet = row.fee_effect_rwf !== null;
  const stateSet = row.settlement_state !== null;
  const affectsSet = row.affects_balance !== null;
  const reasonSet = row.effect_reason !== null;
  const allSet = principalSet && feeSet && stateSet && affectsSet &&
    reasonSet;
  const noneSet = !principalSet && !feeSet && !stateSet && !affectsSet &&
    !reasonSet;

  if (allSet) {
    return {
      row,
      category: "already_processed",
      reason:
        "all five accounting columns already populated - outside the eligibility predicate, never re-touched",
      effect: null,
    };
  }

  if (!noneSet) {
    // Should be structurally impossible - the database's
    // transactions_new_accounting_fields_all_or_nothing constraint forbids
    // this. Defense in depth only: never guess which fields to trust.
    return {
      row,
      category: "contradictory_partial_state",
      reason:
        "some but not all of the five accounting columns are populated - violates the all-or-nothing invariant; requires manual investigation, never auto-repaired",
      effect: null,
    };
  }

  const amount = Number(row.amount_rwf);
  const fee = Number(row.fee_rwf);

  if (amount < 0 || fee < 0) {
    // Should be structurally impossible - amount_rwf/fee_rwf both carry a
    // ">= 0" CHECK constraint. Defense in depth only.
    return {
      row,
      category: "malformed_negative_amount",
      reason: "amount_rwf or fee_rwf is negative",
      effect: null,
    };
  }

  if (!VALID_DIRECTIONS.includes(row.direction)) {
    return {
      row,
      category: "unrecognized_status_or_direction",
      reason: `direction "${row.direction}" is not one of ${
        VALID_DIRECTIONS.join(", ")
      }`,
      effect: null,
    };
  }

  if (!VALID_STATUSES.includes(row.status)) {
    return {
      row,
      category: "unrecognized_status_or_direction",
      reason: `status "${row.status}" is not one of ${
        VALID_STATUSES.join(", ")
      }`,
      effect: null,
    };
  }

  // The one documented, dormant TS/SQL divergence (see accounting.ts and
  // README.md "Known, documented, dormant semantic gap"): an incoming
  // transfer with a nonzero fee. Excluded explicitly here, before ever
  // computing or attempting to write an effect for it - not left to the
  // database's transactions_net_effect_matches_new_accounting_fields
  // constraint to reject as the only backstop.
  if (row.direction === "in" && fee > 0) {
    return {
      row,
      category: "unsupported_incoming_with_fee",
      reason:
        "incoming transfer with a nonzero fee - computeAccountingEffect() and the generated net_effect_rwf column are not proven equivalent for this case; excluded per standing Phase 3/4 policy, not guessed at",
      effect: null,
    };
  }

  const effect = computeAccountingEffect({
    direction: row.direction as TransactionDirection,
    status: row.status as TransactionStatus,
    amount_rwf: amount,
    fee_rwf: fee,
  });

  const netEffectColumn = Number(row.net_effect_rwf);
  if (netEffectColumn !== effect.net_effect_rwf) {
    // Independent local re-verification of the same cross-check the
    // database's transactions_net_effect_matches_new_accounting_fields
    // constraint performs. If this ever disagrees for a row that made it
    // past the check above, something about this row's shape is not
    // understood - fail closed rather than let the database constraint be
    // the only thing standing between this tool and a rejected write.
    return {
      row,
      category: "contradictory_partial_state",
      reason:
        `computeAccountingEffect() net_effect_rwf (${effect.net_effect_rwf}) disagrees with the generated net_effect_rwf column (${netEffectColumn}) - refusing to guess which is right`,
      effect: null,
    };
  }

  return { row, category: "eligible", reason: "passes all checks", effect };
}

// ===========================================================================
// Plan (read-only)
// ===========================================================================

export function buildPlan(
  rows: TransactionRow[],
  sourceHost: string,
  sourceDatabase: string,
): Plan {
  const runId = crypto.randomUUID();
  const excluded: Record<string, number> = {};
  const excludedIds: Record<string, string[]> = {};
  const entries: PlanEntry[] = [];
  let alreadyProcessed = 0;

  for (const row of rows) {
    const classification = classifyRow(row);

    if (classification.category === "already_processed") {
      alreadyProcessed++;
      continue;
    }

    if (classification.category === "eligible" && classification.effect) {
      entries.push({
        id: row.id,
        transaction_type: row.transaction_type,
        direction: row.direction,
        status: row.status,
        amount_rwf: Number(row.amount_rwf),
        fee_rwf: Number(row.fee_rwf),
        net_effect_rwf: Number(row.net_effect_rwf),
        expected_effect: classification.effect,
      });
      continue;
    }

    excluded[classification.category] =
      (excluded[classification.category] ?? 0) + 1;
    (excludedIds[classification.category] ??= []).push(row.id);
  }

  return {
    run_id: runId,
    generated_at: new Date().toISOString(),
    mode: "plan",
    source_host: sourceHost,
    source_database: sourceDatabase,
    total_transactions: rows.length,
    eligible_count: entries.length,
    already_processed_count: alreadyProcessed,
    excluded,
    excluded_ids: excludedIds,
    entries,
  };
}

// ===========================================================================
// Execute (writes - compare-and-set, one row per statement)
// ===========================================================================

export async function executePlan(
  sql: postgres.Sql,
  plan: Plan,
  sourceHost: string,
  sourceDatabase: string,
): Promise<ExecuteResultLog> {
  const results: ExecuteResultRow[] = [];

  for (const entry of plan.entries) {
    // Snapshot the current before-state first, purely for the rollback
    // record - the actual write below is still a single atomic
    // compare-and-set statement, not a read-then-write race.
    const beforeRows = await sql<
      {
        principal_effect_rwf: string | number | null;
        fee_effect_rwf: string | number | null;
        settlement_state: string | null;
        affects_balance: boolean | null;
        effect_reason: string | null;
      }[]
    >`
      select principal_effect_rwf, fee_effect_rwf, settlement_state,
             affects_balance, effect_reason
      from transactions
      where id = ${entry.id}
    `;
    // bigint columns come back from postgres.js as strings (precision
    // preservation) - normalize to number immediately so every downstream
    // comparison against computeAccountingEffect()'s plain-number output
    // is a same-type comparison, never a silently-false string/number
    // mismatch.
    const rawBefore = beforeRows[0] ?? null;
    const before = rawBefore
      ? {
        principal_effect_rwf: rawBefore.principal_effect_rwf === null
          ? null
          : Number(rawBefore.principal_effect_rwf),
        fee_effect_rwf: rawBefore.fee_effect_rwf === null
          ? null
          : Number(rawBefore.fee_effect_rwf),
        settlement_state: rawBefore.settlement_state,
        affects_balance: rawBefore.affects_balance,
        effect_reason: rawBefore.effect_reason,
      }
      : null;

    const updated = await sql<{ id: string }[]>`
      update transactions
      set
        principal_effect_rwf = ${entry.expected_effect.principal_effect_rwf},
        fee_effect_rwf = ${entry.expected_effect.fee_effect_rwf},
        settlement_state = ${entry.expected_effect.settlement_state},
        affects_balance = ${entry.expected_effect.affects_balance},
        effect_reason = ${entry.expected_effect.effect_reason}
      where id = ${entry.id}
        and principal_effect_rwf is null
        and fee_effect_rwf is null
        and settlement_state is null
        and affects_balance is null
        and effect_reason is null
        and amount_rwf = ${entry.amount_rwf}
        and fee_rwf = ${entry.fee_rwf}
        and status = ${entry.status}
        and direction = ${entry.direction}
      returning id
    `;

    if (updated.length === 1) {
      results.push({
        id: entry.id,
        outcome: "updated",
        before,
        after: entry.expected_effect,
      });
      continue;
    }

    // Zero rows matched. Either this row was already updated to exactly
    // what we intended (benign - idempotent rerun of a partially-completed
    // prior execution), or it changed to something else since the plan was
    // generated (a genuine conflict - never overwritten, always flagged).
    if (
      before &&
      before.principal_effect_rwf ===
        entry.expected_effect.principal_effect_rwf &&
      before.fee_effect_rwf === entry.expected_effect.fee_effect_rwf &&
      before.settlement_state === entry.expected_effect.settlement_state &&
      before.affects_balance === entry.expected_effect.affects_balance &&
      before.effect_reason === entry.expected_effect.effect_reason
    ) {
      results.push({
        id: entry.id,
        outcome: "already_applied_matches_plan",
        before,
        after: entry.expected_effect,
      });
    } else {
      results.push({
        id: entry.id,
        outcome: "cas_failed_unexpected_state",
        before,
        after: null,
        detail:
          "row's accounting columns or source fields no longer match what the plan expected - not written, requires manual review",
      });
    }
  }

  const summary: Record<string, number> = {};
  for (const r of results) {
    summary[r.outcome] = (summary[r.outcome] ?? 0) + 1;
  }

  return {
    run_id: crypto.randomUUID(),
    plan_run_id: plan.run_id,
    executed_at: new Date().toISOString(),
    mode: "execute",
    source_host: sourceHost,
    source_database: sourceDatabase,
    results,
    summary,
  };
}

// ===========================================================================
// Rollback (writes - compare-and-set, reverts only rows this exact run
// updated, only if they still hold exactly what this run wrote)
// ===========================================================================

export async function rollbackResultLog(
  sql: postgres.Sql,
  resultLog: ExecuteResultLog,
): Promise<
  {
    id: string;
    outcome: "reverted" | "skipped_not_updated" | "skipped_changed_since";
  }[]
> {
  const outcomes: {
    id: string;
    outcome: "reverted" | "skipped_not_updated" | "skipped_changed_since";
  }[] = [];

  for (const r of resultLog.results) {
    if (r.outcome !== "updated" || !r.after) {
      outcomes.push({ id: r.id, outcome: "skipped_not_updated" });
      continue;
    }

    const reverted = await sql<{ id: string }[]>`
      update transactions
      set
        principal_effect_rwf = null,
        fee_effect_rwf = null,
        settlement_state = null,
        affects_balance = null,
        effect_reason = null
      where id = ${r.id}
        and principal_effect_rwf = ${r.after.principal_effect_rwf}
        and fee_effect_rwf = ${r.after.fee_effect_rwf}
        and settlement_state = ${r.after.settlement_state}
        and affects_balance = ${r.after.affects_balance}
        and effect_reason = ${r.after.effect_reason}
      returning id
    `;

    outcomes.push({
      id: r.id,
      outcome: reverted.length === 1 ? "reverted" : "skipped_changed_since",
    });
  }

  return outcomes;
}

// ===========================================================================
// CLI entry point
// ===========================================================================

function connect(): { sql: postgres.Sql; host: string; database: string } {
  const databaseUrl = Deno.env.get("DATABASE_URL");
  const host = Deno.env.get("PGHOST") ?? "";
  const database = Deno.env.get("PGDATABASE") ?? "postgres";

  if (!databaseUrl && !host) {
    throw new Error(
      "Set either DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE before running this script.",
    );
  }

  const sql = databaseUrl ? postgres(databaseUrl, { max: 1 }) : postgres({
    host,
    port: Number(Deno.env.get("PGPORT") ?? "5432"),
    username: Deno.env.get("PGUSER") ?? "postgres",
    password: Deno.env.get("PGPASSWORD"),
    database,
    max: 1,
  });

  return { sql, host, database };
}

async function ensureBackfillRunsDir(): Promise<string> {
  const dir = new URL("./backfill-runs/", import.meta.url).pathname;
  await Deno.mkdir(dir, { recursive: true });
  return dir;
}

async function cmdPlan() {
  const { sql, host, database } = connect();
  try {
    const rows = await sql<TransactionRow[]>`
      select id, transaction_type, direction, status, amount_rwf, fee_rwf,
             net_effect_rwf, principal_effect_rwf, fee_effect_rwf,
             settlement_state, affects_balance, effect_reason, created_at
      from transactions
      order by created_at, id
    `;

    const plan = buildPlan(rows, host, database);
    const dir = await ensureBackfillRunsDir();
    const path = `${dir}plan-${
      plan.generated_at.replace(/[:.]/g, "-")
    }-${plan.run_id}.json`;
    await Deno.writeTextFile(path, JSON.stringify(plan, null, 2));

    console.log(`Plan written to ${path}`);
    console.log(`  total transactions:    ${plan.total_transactions}`);
    console.log(`  already processed:     ${plan.already_processed_count}`);
    console.log(`  eligible:               ${plan.eligible_count}`);
    for (const [category, count] of Object.entries(plan.excluded)) {
      console.log(`  excluded (${category}): ${count}`);
    }
  } finally {
    await sql.end();
  }
}

async function cmdExecute(args: string[]) {
  const planIdx = args.indexOf("--plan");
  const confirmed = args.includes("--confirm");
  if (planIdx === -1 || !args[planIdx + 1]) {
    throw new Error("execute requires --plan <path-to-plan-json>");
  }
  if (!confirmed) {
    throw new Error(
      "execute requires --confirm - this is the only mode that writes to the database. Refusing to proceed without it.",
    );
  }

  const plan: Plan = JSON.parse(await Deno.readTextFile(args[planIdx + 1]));
  const { sql, host, database } = connect();
  try {
    const resultLog = await executePlan(sql, plan, host, database);
    const dir = await ensureBackfillRunsDir();
    const path = `${dir}execute-${
      resultLog.executed_at.replace(/[:.]/g, "-")
    }-${resultLog.run_id}.json`;
    await Deno.writeTextFile(path, JSON.stringify(resultLog, null, 2));

    console.log(`Result log written to ${path}`);
    for (const [outcome, count] of Object.entries(resultLog.summary)) {
      console.log(`  ${outcome}: ${count}`);
    }
  } finally {
    await sql.end();
  }
}

async function cmdRollback(args: string[]) {
  const logIdx = args.indexOf("--result-log");
  const confirmed = args.includes("--confirm");
  if (logIdx === -1 || !args[logIdx + 1]) {
    throw new Error(
      "rollback requires --result-log <path-to-execute-result-json>",
    );
  }
  if (!confirmed) {
    throw new Error(
      "rollback requires --confirm - refusing to proceed without it.",
    );
  }

  const resultLog: ExecuteResultLog = JSON.parse(
    await Deno.readTextFile(args[logIdx + 1]),
  );
  const { sql } = connect();
  try {
    const outcomes = await rollbackResultLog(sql, resultLog);
    const dir = await ensureBackfillRunsDir();
    const path = `${dir}rollback-${
      new Date().toISOString().replace(/[:.]/g, "-")
    }.json`;
    await Deno.writeTextFile(path, JSON.stringify(outcomes, null, 2));

    console.log(`Rollback log written to ${path}`);
    const summary: Record<string, number> = {};
    for (const o of outcomes) {
      summary[o.outcome] = (summary[o.outcome] ?? 0) + 1;
    }
    for (const [outcome, count] of Object.entries(summary)) {
      console.log(`  ${outcome}: ${count}`);
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const [command, ...rest] = Deno.args;
  try {
    switch (command) {
      case "plan":
        await cmdPlan();
        break;
      case "execute":
        await cmdExecute(rest);
        break;
      case "rollback":
        await cmdRollback(rest);
        break;
      default:
        console.error(
          "Usage: deno run -A scripts/phase-4-1-accounting-backfill.ts <plan|execute|rollback> [options]",
        );
        Deno.exit(1);
    }
  } catch (err) {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    Deno.exit(1);
  }
}
