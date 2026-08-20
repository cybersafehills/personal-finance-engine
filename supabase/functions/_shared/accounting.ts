// Deterministic accounting engine.
//
// CRITICAL: this is the single canonical place where a transaction's
// financial effect is calculated. No other module - Edge Function, SQL
// migration, frontend, or future report - may recompute
// principal/fee/net effect independently. If a database column needs to
// reflect these numbers, it is populated by calling this module, never by
// a parallel SQL expression.
//
// AI/LLMs must never be involved in producing these numbers. This module
// is pure, synchronous, and has no dependency on Supabase, the network, or
// wall-clock time - every output is a deterministic function of its input.
//
// This engine deliberately answers only "how did this transaction move
// cash" (principal / fee / net / affects_balance / settlement_state). It
// does NOT decide whether an outgoing transaction is "spending" vs. a
// "transfer" vs. a "reimbursement" - that is a categorization concern
// already handled separately by transaction_type and merchant_rules
// (Phase 4). direction ("in"/"out"/"neutral") is the accounting-relevant
// signal; transaction_type is the categorization-relevant signal, and the
// two are intentionally kept independent here.

import type { AccountingEffect, AccountingInput } from "./types.ts";
import { addRwf, assertSafeRwfInteger, negateRwf } from "./money.ts";

/**
 * Computes the deterministic financial effect of a single transaction.
 *
 * Rules (Phase 3):
 *   - status "success": principal moves by +/-amount_rwf depending on
 *     direction, fee always moves the account down by fee_rwf, and the
 *     transaction affects the balance.
 *   - status "failed": the attempted amount is preserved for evidence
 *     (gross_amount_rwf), but principal/fee/net effect are all 0 and the
 *     transaction never affects the balance.
 *   - status "pending": treated as not yet settled - zero effect, does not
 *     affect the balance, until real verified semantics prove otherwise.
 *   - status "reversed": the model is deliberately conservative. We know a
 *     reversal must never be counted as a second expense, but no
 *     confirmed real-world MTN reversal SMS sample exists yet (see
 *     ingest-momo/README.md "Unsupported formats"), so the correct
 *     compensating sign cannot be determined safely. Effect is forced to
 *     0 and excluded from balance until a real sample lets the parser and
 *     this engine be extended together.
 *   - status "unknown": excluded from totals unconditionally.
 */
export function computeAccountingEffect(
  input: AccountingInput,
): AccountingEffect {
  assertSafeRwfInteger(input.amount_rwf, "amount_rwf");
  assertSafeRwfInteger(input.fee_rwf, "fee_rwf");

  if (input.amount_rwf < 0) {
    throw new RangeError("amount_rwf must not be negative");
  }

  if (input.fee_rwf < 0) {
    throw new RangeError("fee_rwf must not be negative");
  }

  switch (input.status) {
    case "failed":
      return noEffect(input, "failed", "failed_transaction_no_settlement");

    case "pending":
      return noEffect(input, "pending", "pending_not_yet_settled");

    case "unknown":
      return noEffect(input, "unknown", "unknown_status_excluded_from_totals");

    case "reversed":
      return noEffect(
        input,
        "reversed",
        "reversed_effect_deferred_pending_real_sample",
      );

    case "success":
      return computeSettledEffect(input);

    default:
      // Defensive: the TransactionStatus union is exhaustive at compile
      // time, but this function can still be called at runtime with a
      // value that bypassed type checking (e.g. a raw DB row read with a
      // stale/unexpected status string, or an `as` cast). Never fall
      // through silently - an unrecognized status must never be treated
      // as either settled or safely zero.
      throw new RangeError(
        `Unrecognized transaction status: ${String(input.status)}`,
      );
  }
}

function computeSettledEffect(input: AccountingInput): AccountingEffect {
  const feeEffect = input.fee_rwf === 0 ? 0 : negateRwf(input.fee_rwf);

  let principalEffect: number;
  let directionLabel: string;

  switch (input.direction) {
    case "out":
      principalEffect = negateRwf(input.amount_rwf);
      directionLabel = "outgoing";
      break;

    case "in":
      principalEffect = input.amount_rwf;
      directionLabel = "incoming";
      break;

    case "neutral":
      // No confirmed real MTN message currently uses direction "neutral".
      // A neutral event is only well-defined when it moves no principal
      // cash (e.g. a hypothetical fee-only informational event) - only an
      // associated fee, if any, would affect the balance. A "neutral"
      // transaction with a nonzero amount is a contradictory input we
      // cannot interpret (which way would that amount move?): rather than
      // silently discarding the amount, treat it as unsupported and
      // exclude it from authoritative totals.
      if (input.amount_rwf !== 0) {
        return noEffect(
          input,
          "unknown",
          "neutral_direction_with_nonzero_amount_unsupported",
        );
      }

      principalEffect = 0;
      directionLabel = "neutral";
      break;

    default:
      // Defensive: same rationale as the status exhaustiveness guard
      // above - never silently fall through for an unrecognized
      // direction value.
      throw new RangeError(
        `Unrecognized transaction direction: ${String(input.direction)}`,
      );
  }

  const netEffect = addRwf(principalEffect, feeEffect);
  const feeLabel = feeEffect === 0 ? "no_fee" : "with_fee";

  return {
    gross_amount_rwf: input.amount_rwf,
    fee_rwf: input.fee_rwf,
    principal_effect_rwf: principalEffect,
    fee_effect_rwf: feeEffect,
    net_effect_rwf: netEffect,
    affects_balance: true,
    settlement_state: "settled",
    effect_reason: `settled_${directionLabel}_${feeLabel}`,
  };
}

/**
 * Type guard for a `transactions` row's nullable accounting-effect columns
 * (principal_effect_rwf, fee_effect_rwf, net_effect_rwf, settlement_state,
 * affects_balance).
 *
 * NULL invariant: a NULL value in any of these columns means "this engine
 * has not yet processed this row" - it is NOT equivalent to a computed
 * zero effect. A transaction that genuinely has zero financial effect
 * (e.g. a failed transaction) has these columns populated with explicit
 * zeros/false and a settlement_state, not NULL. Any future code that reads
 * these columns (reports, totals, dashboards) MUST check this guard - or
 * equivalently `settlement_state IS NOT NULL` in SQL - before treating a
 * row as authoritative, rather than assuming NULL sums to zero. Do not
 * write `row.net_effect_rwf ?? 0`; that silently miscounts unprocessed
 * transactions as zero-effect ones.
 */
export function hasComputedAccountingEffect(row: {
  principal_effect_rwf: number | null;
  fee_effect_rwf: number | null;
  net_effect_rwf: number | null;
  settlement_state: string | null;
  affects_balance: boolean | null;
}): boolean {
  return (
    row.principal_effect_rwf !== null &&
    row.fee_effect_rwf !== null &&
    row.net_effect_rwf !== null &&
    row.settlement_state !== null &&
    row.affects_balance !== null
  );
}

function noEffect(
  input: AccountingInput,
  settlementState: Exclude<AccountingEffect["settlement_state"], "settled">,
  reason: string,
): AccountingEffect {
  return {
    gross_amount_rwf: input.amount_rwf,
    fee_rwf: input.fee_rwf,
    principal_effect_rwf: 0,
    fee_effect_rwf: 0,
    net_effect_rwf: 0,
    affects_balance: false,
    settlement_state: settlementState,
    effect_reason: reason,
  };
}
