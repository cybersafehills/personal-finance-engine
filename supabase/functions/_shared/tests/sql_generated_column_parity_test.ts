// Parity/divergence tests between the PostgreSQL GENERATED ALWAYS AS (...)
// STORED expression for transactions.net_effect_rwf (defined in
// 20260818000000_baseline_existing_schema.sql) and the canonical TypeScript
// engine, computeAccountingEffect() (accounting.ts).
//
// mirrorOfSqlNetEffect() below exists SOLELY to detect drift between the two
// implementations in tests. It must NEVER be imported by application code -
// the production database's generated column is the only place this SQL
// formula actually runs. If the SQL expression in
// 20260818000000_baseline_existing_schema.sql ever changes, update this
// mirror to match, or these tests stop meaning anything.
//
// KNOWN, DOCUMENTED, DORMANT DIVERGENCE: for direction "in" with a nonzero
// fee, the SQL expression returns `amount_rwf` (ignoring fee entirely),
// while computeAccountingEffect() always subtracts the fee regardless of
// direction, returning `amount_rwf - fee_rwf`. This is a real difference,
// NOT a bug in either implementation individually - see the investigation
// notes in 20260818130000_accounting_foundation.sql.
//
// Why this is left unresolved rather than "fixed": no real-world MTN
// Rwanda SMS sample showing a fee charged on an incoming transfer exists.
// ingest-momo's parser (parser.ts) hardcodes fee_rwf = 0 for
// "money_received" precisely because no observed message format reports
// one. Guessing whether such a fee (if it ever appears) should reduce the
// credited balance or was already netted into the reported amount would be
// inventing financial semantics without evidence - explicitly against this
// project's rules. Until a real sample resolves the ambiguity, the two
// implementations are ALLOWED to diverge only for this one, currently
// unreachable, input shape - and this test file exists specifically so
// that divergence stays visible and intentional rather than silent.
//
// transactions_net_effect_matches_new_accounting_fields (the DB constraint
// added alongside the accounting-effect columns) independently guards
// against this: it would reject any attempt to mark a direction="in",
// fee>0 row as accounting-processed with a principal/fee split that
// disagrees with the generated net_effect_rwf, forcing an explicit
// decision before such a row could ever be accepted.

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { computeAccountingEffect } from "../accounting.ts";
import type { AccountingInput } from "../types.ts";

/**
 * Test-only mirror of the SQL GENERATED ALWAYS AS (...) STORED expression
 * for transactions.net_effect_rwf. See module comment - never use this
 * outside tests.
 */
function mirrorOfSqlNetEffect(input: AccountingInput): number {
  if (input.status !== "success") {
    return 0;
  }

  if (input.direction === "out") {
    return -1 * (input.amount_rwf + input.fee_rwf);
  }

  if (input.direction === "in") {
    return input.amount_rwf;
  }

  return 0;
}

const REPRESENTATIVE_CASES: AccountingInput[] = [
  { direction: "out", status: "success", amount_rwf: 4000, fee_rwf: 0 },
  { direction: "out", status: "success", amount_rwf: 1000, fee_rwf: 20 },
  { direction: "out", status: "success", amount_rwf: 50, fee_rwf: 0 },
  { direction: "in", status: "success", amount_rwf: 7500, fee_rwf: 0 },
  { direction: "out", status: "success", amount_rwf: 0, fee_rwf: 0 },
  { direction: "out", status: "failed", amount_rwf: 200, fee_rwf: 0 },
  { direction: "out", status: "pending", amount_rwf: 500, fee_rwf: 0 },
  { direction: "out", status: "reversed", amount_rwf: 1000, fee_rwf: 0 },
  { direction: "out", status: "unknown", amount_rwf: 900, fee_rwf: 0 },
  { direction: "in", status: "failed", amount_rwf: 300, fee_rwf: 0 },
  { direction: "in", status: "pending", amount_rwf: 300, fee_rwf: 0 },
  {
    direction: "out",
    status: "success",
    amount_rwf: 750_000_000,
    fee_rwf: 1500,
  },
];

Deno.test("SQL/TS parity: net_effect_rwf agrees for every currently-reachable real transaction shape", () => {
  for (const input of REPRESENTATIVE_CASES) {
    const sqlValue = mirrorOfSqlNetEffect(input);
    const tsValue = computeAccountingEffect(input).net_effect_rwf;

    assertEquals(
      tsValue,
      sqlValue,
      `Divergence for ${JSON.stringify(input)}: SQL=${sqlValue} TS=${tsValue}`,
    );
  }
});

Deno.test("SQL/TS DOCUMENTED DIVERGENCE: incoming money with a nonzero fee - dormant, unreachable via the current parser", () => {
  const input: AccountingInput = {
    direction: "in",
    status: "success",
    amount_rwf: 1000,
    fee_rwf: 50,
  };

  const sqlValue = mirrorOfSqlNetEffect(input);
  const tsValue = computeAccountingEffect(input).net_effect_rwf;

  // SQL ignores the fee for incoming transfers; TS always subtracts it.
  assertEquals(sqlValue, 1000);
  assertEquals(tsValue, 950);
  assertNotEquals(
    sqlValue,
    tsValue,
    "If this now passes, the two implementations were made to agree - " +
      "update this test's expectations and the module comment, and confirm " +
      "the agreement is backed by a real MTN sample, not a guess.",
  );
});

Deno.test("ingest-momo parser guarantee: money_received never produces a nonzero fee (this is what keeps the divergence dormant)", async () => {
  const { moneyReceivedMessage, commaMoneyReceivedMessage } = await import(
    "../../ingest-momo/tests/fixtures.ts"
  );

  assertEquals(moneyReceivedMessage.expected.fee_rwf, 0);
  assertEquals(commaMoneyReceivedMessage.expected.fee_rwf, 0);
});
