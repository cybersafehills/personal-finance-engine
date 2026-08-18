// Deterministic balance reconciliation engine.
//
// Compares a running, internally-calculated balance against MTN's own
// balance_after_rwf checkpoints. Like accounting.ts, this module is pure,
// synchronous, and has no dependency on Supabase, the network, or
// wall-clock time - the caller supplies `calculatedAt` explicitly rather
// than this module reading the system clock, so repeated runs over the
// same input are byte-for-byte reproducible (idempotent).
//
// Chronology (Phase 8): transactions are ordered by occurred_at, never by
// database insertion order - Shortcut delivery can be delayed, retried, or
// arrive out of order. Reported MTN balances are checkpoints: once a
// transaction's reported balance has been evaluated, the running total
// resyncs to that reported number for everything after it. This means
// drift is flagged (as a "mismatch" checkpoint) rather than silently
// absorbed or compounded, and transactions.balance_after_rwf itself is
// never overwritten by this module - it only reads it.

import type { AccountingEffect, ReconciliationStatus } from "./types.ts";

export type ReconciliationTransactionInput = {
  /** transactions.id - used only as a last-resort, non-chronological tie-breaker. */
  id: string;
  /** transactions.occurred_at - the primary chronological ordering key. */
  occurred_at: string;
  /** transactions.created_at - secondary tie-breaker only, never primary ordering. */
  created_at: string;
  /** transactions.balance_after_rwf - MTN's reported balance, if any. */
  balance_after_rwf: number | null;
  /** Output of computeAccountingEffect for this transaction. */
  effect: AccountingEffect;
};

export type ReconciliationCheckpoint = {
  transaction_id: string;
  expected_balance_rwf: number | null;
  reported_balance_rwf: number | null;
  difference_rwf: number | null;
  status: ReconciliationStatus;
  reason: string;
};

export type ReconciliationRunResult = {
  checkpoints: ReconciliationCheckpoint[];
  /** Running calculated balance after processing every input transaction, or null if never established. */
  closing_calculated_balance_rwf: number | null;
};

export type OpeningBalance = {
  balance_rwf: number;
};

/**
 * Guards against a caller accidentally passing the same transaction more
 * than once (e.g. a buggy query producing a duplicate row). Real duplicate
 * transactions cannot occur in the database - momo_messages.
 * message_fingerprint and transactions.external_transaction_id are unique
 * - but this pure function has no such protection on its own, and
 * silently processing the same id twice would double-count its net effect
 * against the running balance. Fail loudly instead.
 */
function assertNoDuplicateTransactionIds(
  transactions: ReconciliationTransactionInput[],
): void {
  const seen = new Set<string>();

  for (const txn of transactions) {
    if (seen.has(txn.id)) {
      throw new Error(
        `Duplicate transaction id in reconciliation input: ${txn.id}`,
      );
    }

    seen.add(txn.id);
  }
}

/**
 * Deterministic tie-breaking comparator for transaction chronology.
 *
 * Primary key: occurred_at (the actual transaction time, per Phase 8 -
 * never insertion order). Secondary key: created_at (server ingestion
 * time), used only to break ties when two transactions report the exact
 * same occurred_at. Final key: transaction id, compared lexicographically.
 *
 * The id-based final tie-break makes NO claim about true real-world
 * ordering - it exists purely so that, in the rare case both timestamps
 * are identical, the sort is still stable and reproducible across repeated
 * runs rather than depending on input array order.
 */
export function compareTransactionChronology(
  a: ReconciliationTransactionInput,
  b: ReconciliationTransactionInput,
): number {
  const occurredDiff = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);

  if (occurredDiff !== 0) {
    return occurredDiff;
  }

  const createdDiff = Date.parse(a.created_at) - Date.parse(b.created_at);

  if (createdDiff !== 0) {
    return createdDiff;
  }

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;

  return 0;
}

/**
 * Runs reconciliation over a set of transactions (accounting-processed via
 * computeAccountingEffect) against an optional opening balance checkpoint.
 *
 * Produces exactly one checkpoint per input transaction - even
 * non-settling ones - so every transaction has an explicit, explainable
 * reconciliation status rather than being silently skipped (Phase 15).
 */
export function reconcileTransactions(
  transactions: ReconciliationTransactionInput[],
  openingBalance: OpeningBalance | null,
): ReconciliationRunResult {
  assertNoDuplicateTransactionIds(transactions);

  const sorted = [...transactions].sort(compareTransactionChronology);

  let runningBalance: number | null = openingBalance?.balance_rwf ?? null;
  // Once true, this stays true for the rest of the run: this pure function
  // has no way to know if or when an earlier pending transaction later
  // resolved (that would require a new transaction row or a status update
  // it has no visibility into), so every checkpoint after any unresolved
  // pending transaction is conservatively downgraded to pending_review -
  // never silently promoted back to reconciled within a single run.
  let pendingUnresolvedSeen = false;

  const checkpoints: ReconciliationCheckpoint[] = [];

  for (const txn of sorted) {
    const reported = txn.balance_after_rwf;

    if (txn.effect.settlement_state === "pending") {
      pendingUnresolvedSeen = true;

      checkpoints.push({
        transaction_id: txn.id,
        expected_balance_rwf: null,
        reported_balance_rwf: reported,
        difference_rwf: null,
        status: "insufficient_data",
        reason: "pending_not_yet_settled",
      });

      continue;
    }

    if (!txn.effect.affects_balance) {
      checkpoints.push({
        transaction_id: txn.id,
        expected_balance_rwf: null,
        reported_balance_rwf: reported,
        difference_rwf: null,
        status: "insufficient_data",
        reason: `${txn.effect.settlement_state}_excluded_from_balance`,
      });

      continue;
    }

    // Settled and balance-affecting from here on.
    if (runningBalance === null) {
      if (reported === null) {
        checkpoints.push({
          transaction_id: txn.id,
          expected_balance_rwf: null,
          reported_balance_rwf: null,
          difference_rwf: null,
          status: "insufficient_data",
          reason: "no_opening_checkpoint_and_no_reported_balance",
        });

        continue;
      }

      // Bootstrap: no prior evidence to compare against, so we trust this
      // reported balance as the starting checkpoint and continue from it.
      // expected == reported by construction here - this is NOT a verified
      // reconciliation, hence "insufficient_data" rather than "reconciled".
      runningBalance = reported;

      checkpoints.push({
        transaction_id: txn.id,
        expected_balance_rwf: null,
        reported_balance_rwf: reported,
        difference_rwf: null,
        status: "insufficient_data",
        reason: "no_opening_checkpoint_bootstrapped",
      });

      continue;
    }

    const candidateExpected = runningBalance + txn.effect.net_effect_rwf;

    if (reported === null) {
      runningBalance = candidateExpected;

      checkpoints.push({
        transaction_id: txn.id,
        expected_balance_rwf: candidateExpected,
        reported_balance_rwf: null,
        difference_rwf: null,
        status: "insufficient_data",
        reason: "no_reported_balance",
      });

      continue;
    }

    const difference = reported - candidateExpected;

    let status: ReconciliationStatus;
    let reason: string;

    if (pendingUnresolvedSeen) {
      status = "pending_review";
      reason = "unresolved_pending_transaction_in_sequence";
    } else if (difference === 0) {
      status = "reconciled";
      reason = "expected_matches_reported";
    } else {
      status = "mismatch";
      reason = "expected_reported_disagree";
    }

    checkpoints.push({
      transaction_id: txn.id,
      expected_balance_rwf: candidateExpected,
      reported_balance_rwf: reported,
      difference_rwf: difference,
      status,
      reason,
    });

    // Resync to MTN's authoritative reported number for everything after
    // this checkpoint, whether or not it matched - drift is flagged, not
    // compounded forward.
    runningBalance = reported;
  }

  return {
    checkpoints,
    closing_calculated_balance_rwf: runningBalance,
  };
}
