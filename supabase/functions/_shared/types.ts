// Canonical accounting-layer types.
//
// These duplicate the narrow set of transactions-table contract types
// (TransactionDirection, TransactionStatus) that ingest-momo/types.ts also
// defines. That duplication is intentional: the accounting layer must not
// depend on a specific Edge Function's module (ingest-momo is one producer
// of transactions among future possible producers - bank imports, manual
// entry, etc.), and these two unions are database CHECK-constraint
// contracts that change rarely and deliberately. If they drift, the
// `transactions_*_check` constraints in the database are the tie-breaker.

export type TransactionDirection = "in" | "out" | "neutral";

export type TransactionStatus =
  | "success"
  | "failed"
  | "reversed"
  | "pending"
  | "unknown";

/**
 * Deterministic settlement classification for a transaction's financial
 * effect. Distinct from TransactionStatus (the raw MTN-derived status)
 * because it is the accounting layer's own vocabulary for "did this event
 * actually move money."
 */
export type SettlementState =
  | "settled"
  | "failed"
  | "pending"
  | "reversed"
  | "unknown";

/**
 * Reconciliation outcome for a single transaction checkpoint.
 */
export type ReconciliationStatus =
  | "reconciled"
  | "mismatch"
  | "insufficient_data"
  | "pending_review";

export type AccountingInput = {
  direction: TransactionDirection;
  status: TransactionStatus;
  /** Gross/attempted amount in whole RWF, always >= 0. */
  amount_rwf: number;
  /** MTN-charged fee in whole RWF, always >= 0. */
  fee_rwf: number;
};

/**
 * The deterministic financial effect of a single transaction, as computed
 * by computeAccountingEffect (accounting.ts). This is the ONLY place these
 * numbers should ever be calculated - see accounting.ts module comment.
 */
export type AccountingEffect = {
  /** Gross/attempted amount, preserved unchanged for evidence (Phase 4). */
  gross_amount_rwf: number;
  /** Fee as reported, preserved unchanged for evidence. */
  fee_rwf: number;
  /** Signed principal cash movement, excluding fee. 0 unless settled. */
  principal_effect_rwf: number;
  /** Signed fee movement (<= 0). 0 unless settled. */
  fee_effect_rwf: number;
  /** principal_effect_rwf + fee_effect_rwf. */
  net_effect_rwf: number;
  /** Whether this transaction should count toward authoritative totals/balances. */
  affects_balance: boolean;
  settlement_state: SettlementState;
  /** Short machine-readable explanation code, e.g. "settled_outgoing_with_fee". */
  effect_reason: string;
};
