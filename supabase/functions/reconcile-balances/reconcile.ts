// Pure glue between the canonical engines and one balance_reconciliations
// row per checkpoint. No Supabase, no clock - `calculatedAt` is supplied
// by the caller so repeated runs over the same input are byte-for-byte
// reproducible, exactly like reconciliation.ts itself.
//
// The financial math is NOT reimplemented here: computeAccountingEffect
// (accounting.ts) and reconcileTransactions (reconciliation.ts) remain the
// single canonical source. This module only maps their output onto the
// table's column shape.

import { computeAccountingEffect } from "../_shared/accounting.ts";
import {
  reconcileTransactions,
  type ReconciliationTransactionInput,
} from "../_shared/reconciliation.ts";
import type { ReconciliationStatus } from "../_shared/types.ts";

/** The transactions columns this job needs, as read from the DB. */
export type LedgerTxnRow = {
  id: string;
  occurred_at: string;
  created_at: string;
  balance_after_rwf: number | null;
  direction: "in" | "out" | "neutral";
  status: "success" | "failed" | "reversed" | "pending" | "unknown";
  amount_rwf: number;
  fee_rwf: number;
};

/** One row ready to upsert into public.balance_reconciliations. */
export type BalanceReconciliationRow = {
  account_id: string;
  transaction_id: string;
  expected_balance_rwf: number | null;
  reported_balance_rwf: number | null;
  difference_rwf: number | null;
  status: ReconciliationStatus;
  reason: string;
  calculated_at: string;
};

/**
 * Runs the canonical reconciliation engine over one account's transactions
 * and returns one row per checkpoint (one per input transaction, even
 * non-settling ones - the engine guarantees that). `openingBalance` is
 * always null: OneLedger stores no per-account opening checkpoint, so the
 * engine bootstraps from the first transaction that reports a balance,
 * exactly as it does for MTN.
 */
export function buildBalanceReconciliationRows(
  accountId: string,
  transactions: readonly LedgerTxnRow[],
  calculatedAt: string,
): BalanceReconciliationRow[] {
  const inputs: ReconciliationTransactionInput[] = transactions.map((t) => ({
    id: t.id,
    occurred_at: t.occurred_at,
    created_at: t.created_at,
    balance_after_rwf: t.balance_after_rwf,
    effect: computeAccountingEffect({
      direction: t.direction,
      status: t.status,
      amount_rwf: t.amount_rwf,
      fee_rwf: t.fee_rwf,
    }),
  }));

  const { checkpoints } = reconcileTransactions(inputs, null);

  return checkpoints.map((c) => ({
    account_id: accountId,
    transaction_id: c.transaction_id,
    expected_balance_rwf: c.expected_balance_rwf,
    reported_balance_rwf: c.reported_balance_rwf,
    difference_rwf: c.difference_rwf,
    status: c.status,
    reason: c.reason,
    calculated_at: calculatedAt,
  }));
}

/** Splits an array into fixed-size chunks (for batched upserts). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
