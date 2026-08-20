import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { computeAccountingEffect } from "../accounting.ts";
import {
  compareTransactionChronology,
  reconcileTransactions,
  type ReconciliationTransactionInput,
} from "../reconciliation.ts";

let nextId = 1;

function txn(
  overrides: Partial<ReconciliationTransactionInput> & {
    amount_rwf?: number;
    fee_rwf?: number;
    direction?: "in" | "out" | "neutral";
    status?: "success" | "failed" | "reversed" | "pending" | "unknown";
  } = {},
): ReconciliationTransactionInput {
  const effect = computeAccountingEffect({
    direction: overrides.direction ?? "out",
    status: overrides.status ?? "success",
    amount_rwf: overrides.amount_rwf ?? 0,
    fee_rwf: overrides.fee_rwf ?? 0,
  });

  return {
    id: overrides.id ?? `txn-${nextId++}`,
    occurred_at: overrides.occurred_at ?? "2026-08-18T09:00:00+02:00",
    created_at: overrides.created_at ?? "2026-08-18T09:00:05+02:00",
    balance_after_rwf: overrides.balance_after_rwf ?? null,
    effect,
  };
}

// ===========================================================================
// G. Sequential reconciliation: opening balance -> transaction -> reported
// closing balance matches -> reconciled.
// ===========================================================================

Deno.test("G. opening balance + settled transaction matching reported balance -> reconciled", () => {
  const t = txn({ amount_rwf: 500, balance_after_rwf: 500 });

  const result = reconcileTransactions([t], { balance_rwf: 1000 });

  assertEquals(result.checkpoints.length, 1);
  assertEquals(result.checkpoints[0].status, "reconciled");
  assertEquals(result.checkpoints[0].expected_balance_rwf, 500);
  assertEquals(result.checkpoints[0].reported_balance_rwf, 500);
  assertEquals(result.checkpoints[0].difference_rwf, 0);
  assertEquals(result.closing_calculated_balance_rwf, 500);
});

// ===========================================================================
// H. Reconciliation mismatch.
// ===========================================================================

Deno.test("H. reported balance disagreeing with expected -> mismatch with correct difference", () => {
  const t = txn({ amount_rwf: 500, balance_after_rwf: 450 });

  const result = reconcileTransactions([t], { balance_rwf: 1000 });

  assertEquals(result.checkpoints[0].status, "mismatch");
  assertEquals(result.checkpoints[0].expected_balance_rwf, 500);
  assertEquals(result.checkpoints[0].reported_balance_rwf, 450);
  assertEquals(result.checkpoints[0].difference_rwf, -50);
  // Running balance resyncs to MTN's reported number, not our calculation.
  assertEquals(result.closing_calculated_balance_rwf, 450);
});

// ===========================================================================
// I. Missing balance -> insufficient_data, never a false mismatch.
// ===========================================================================

Deno.test("I. transaction with no reported balance -> insufficient_data, not a false mismatch", () => {
  const t = txn({ amount_rwf: 300, balance_after_rwf: null });

  const result = reconcileTransactions([t], { balance_rwf: 1000 });

  assertEquals(result.checkpoints[0].status, "insufficient_data");
  assertEquals(result.checkpoints[0].reason, "no_reported_balance");
  assertEquals(result.checkpoints[0].reported_balance_rwf, null);
  assertEquals(result.checkpoints[0].difference_rwf, null);
  // We still silently carry the calculated running balance forward.
  assertEquals(result.checkpoints[0].expected_balance_rwf, 700);
  assertEquals(result.closing_calculated_balance_rwf, 700);
});

Deno.test("no opening balance and no reported balance at all -> insufficient_data, no false claims", () => {
  const t = txn({ amount_rwf: 300, balance_after_rwf: null });

  const result = reconcileTransactions([t], null);

  assertEquals(result.checkpoints[0].status, "insufficient_data");
  assertEquals(
    result.checkpoints[0].reason,
    "no_opening_checkpoint_and_no_reported_balance",
  );
  assertEquals(result.closing_calculated_balance_rwf, null);
});

Deno.test("first transaction with a reported balance but no opening checkpoint bootstraps rather than reconciling", () => {
  const t = txn({ amount_rwf: 300, balance_after_rwf: 700 });

  const result = reconcileTransactions([t], null);

  assertEquals(result.checkpoints[0].status, "insufficient_data");
  assertEquals(
    result.checkpoints[0].reason,
    "no_opening_checkpoint_bootstrapped",
  );
  assertEquals(result.closing_calculated_balance_rwf, 700);
});

Deno.test("failed transaction never produces a mismatch even if it happens to carry a reported balance", () => {
  const t = txn({
    amount_rwf: 200,
    status: "failed",
    balance_after_rwf: 1000,
  });

  const result = reconcileTransactions([t], { balance_rwf: 1000 });

  assertEquals(result.checkpoints[0].status, "insufficient_data");
  assertEquals(result.checkpoints[0].reason, "failed_excluded_from_balance");
  // Running balance is untouched by a non-settling transaction.
  assertEquals(result.closing_calculated_balance_rwf, 1000);
});

// ===========================================================================
// J. Out-of-order ingestion: chronology must follow occurred_at, never
// insertion/array order or created_at (server receipt) order.
// ===========================================================================

Deno.test("J. reconciliation orders by occurred_at even when ingestion/array order is reversed", () => {
  const earlyOccurrence = txn({
    id: "occurred-first",
    occurred_at: "2026-08-18T09:00:00+02:00",
    // Delivered to the server LATE relative to the other transaction.
    created_at: "2026-08-18T12:00:00+02:00",
    amount_rwf: 100,
    balance_after_rwf: 900,
  });

  const laterOccurrence = txn({
    id: "occurred-second",
    occurred_at: "2026-08-18T10:00:00+02:00",
    // Delivered to the server EARLIER than the transaction that actually
    // happened first.
    created_at: "2026-08-18T09:05:00+02:00",
    amount_rwf: 50,
    balance_after_rwf: 850,
  });

  // Input array is in ingestion/created_at order, not occurred_at order.
  const result = reconcileTransactions(
    [laterOccurrence, earlyOccurrence],
    { balance_rwf: 1000 },
  );

  assertEquals(result.checkpoints.map((c) => c.transaction_id), [
    "occurred-first",
    "occurred-second",
  ]);
  assertEquals(result.checkpoints[0].status, "reconciled");
  assertEquals(result.checkpoints[1].status, "reconciled");
  assertEquals(result.closing_calculated_balance_rwf, 850);
});

Deno.test("compareTransactionChronology falls back to created_at when occurred_at ties", () => {
  const a = txn({
    id: "a",
    occurred_at: "2026-08-18T09:00:00+02:00",
    created_at: "2026-08-18T09:00:01+02:00",
  });
  const b = txn({
    id: "b",
    occurred_at: "2026-08-18T09:00:00+02:00",
    created_at: "2026-08-18T09:00:02+02:00",
  });

  assertEquals(compareTransactionChronology(a, b) < 0, true);
  assertEquals(compareTransactionChronology(b, a) > 0, true);
});

Deno.test("compareTransactionChronology falls back to id as a final, stable (not chronological) tie-break", () => {
  const sameInstant = "2026-08-18T09:00:00+02:00";
  const y = txn({ id: "y", occurred_at: sameInstant, created_at: sameInstant });
  const z = txn({ id: "z", occurred_at: sameInstant, created_at: sameInstant });

  assertEquals(compareTransactionChronology(y, z) < 0, true);
  assertEquals(compareTransactionChronology(z, y) > 0, true);
  assertEquals(compareTransactionChronology(y, y), 0);
});

// ===========================================================================
// Pending transactions downgrade subsequent checkpoints to pending_review.
// ===========================================================================

Deno.test("an unresolved pending transaction downgrades later checkpoints to pending_review", () => {
  const pending = txn({
    id: "pending-1",
    occurred_at: "2026-08-18T09:00:00+02:00",
    status: "pending",
    amount_rwf: 100,
  });

  const settledAfter = txn({
    id: "settled-after",
    occurred_at: "2026-08-18T10:00:00+02:00",
    amount_rwf: 200,
    balance_after_rwf: 800,
  });

  const result = reconcileTransactions(
    [pending, settledAfter],
    { balance_rwf: 1000 },
  );

  assertEquals(result.checkpoints[0].status, "insufficient_data");
  assertEquals(result.checkpoints[0].reason, "pending_not_yet_settled");
  assertEquals(result.checkpoints[1].status, "pending_review");
  assertEquals(
    result.checkpoints[1].reason,
    "unresolved_pending_transaction_in_sequence",
  );
  // The expected/reported/difference figures are still surfaced for
  // transparency even while marked pending_review.
  assertEquals(result.checkpoints[1].expected_balance_rwf, 800);
  assertEquals(result.checkpoints[1].reported_balance_rwf, 800);
});

// ===========================================================================
// Adversarial review: consecutive gaps, mixed non-settling statuses,
// duplicates, negative drift, multiple pending transactions, fee inclusion.
// ===========================================================================

Deno.test("adversarial: consecutive transactions with no reported balance keep accumulating silently", () => {
  const t1 = txn({
    id: "1",
    occurred_at: "2026-08-18T09:00:00+02:00",
    amount_rwf: 100,
    balance_after_rwf: null,
  });
  const t2 = txn({
    id: "2",
    occurred_at: "2026-08-18T10:00:00+02:00",
    amount_rwf: 50,
    balance_after_rwf: null,
  });

  const result = reconcileTransactions([t1, t2], { balance_rwf: 1000 });

  assertEquals(result.checkpoints[0].status, "insufficient_data");
  assertEquals(result.checkpoints[0].expected_balance_rwf, 900);
  assertEquals(result.checkpoints[1].status, "insufficient_data");
  assertEquals(result.checkpoints[1].expected_balance_rwf, 850);
  assertEquals(result.closing_calculated_balance_rwf, 850);
});

Deno.test("adversarial: a failed transaction between two reconciled checkpoints does not disturb either", () => {
  const t1 = txn({
    id: "1",
    occurred_at: "2026-08-18T09:00:00+02:00",
    amount_rwf: 100,
    balance_after_rwf: 900,
  });
  const failed = txn({
    id: "2",
    occurred_at: "2026-08-18T09:30:00+02:00",
    status: "failed",
    amount_rwf: 50,
    balance_after_rwf: 900,
  });
  const t3 = txn({
    id: "3",
    occurred_at: "2026-08-18T10:00:00+02:00",
    amount_rwf: 200,
    balance_after_rwf: 700,
  });

  const result = reconcileTransactions([t1, failed, t3], { balance_rwf: 1000 });

  assertEquals(result.checkpoints[0].status, "reconciled");
  assertEquals(result.checkpoints[1].status, "insufficient_data");
  assertEquals(result.checkpoints[1].reason, "failed_excluded_from_balance");
  assertEquals(result.checkpoints[2].status, "reconciled");
  assertEquals(result.checkpoints[2].expected_balance_rwf, 700);
  assertEquals(result.closing_calculated_balance_rwf, 700);
});

Deno.test("adversarial: an unknown/needs-review transaction between checkpoints is excluded, not falsely reconciled", () => {
  const t1 = txn({
    id: "1",
    occurred_at: "2026-08-18T09:00:00+02:00",
    amount_rwf: 100,
    balance_after_rwf: 900,
  });
  const unknown = txn({
    id: "2",
    occurred_at: "2026-08-18T09:30:00+02:00",
    status: "unknown",
    amount_rwf: 5000,
    balance_after_rwf: 1,
  });

  const result = reconcileTransactions([t1, unknown], { balance_rwf: 1000 });

  assertEquals(result.checkpoints[1].status, "insufficient_data");
  assertEquals(result.checkpoints[1].reason, "unknown_excluded_from_balance");
  // The wildly inconsistent reported balance on the unknown transaction
  // must not be allowed to corrupt the running balance.
  assertEquals(result.closing_calculated_balance_rwf, 900);
});

Deno.test("adversarial: a duplicated transaction id in the input throws rather than double-counting its effect", () => {
  const t = txn({ id: "dup", amount_rwf: 100, balance_after_rwf: 900 });

  assertThrows(
    () => reconcileTransactions([t, t], { balance_rwf: 1000 }),
    Error,
    "Duplicate transaction id",
  );
});

Deno.test("adversarial: a calculated balance can legitimately go negative, surfaced as a mismatch, not a crash", () => {
  const t = txn({ amount_rwf: 5000, balance_after_rwf: 0 });

  const result = reconcileTransactions([t], { balance_rwf: 1000 });

  assertEquals(result.checkpoints[0].expected_balance_rwf, -4000);
  assertEquals(result.checkpoints[0].status, "mismatch");
  assertEquals(result.checkpoints[0].difference_rwf, 4000);
});

Deno.test("adversarial: two unresolved pending transactions in sequence still leave the next checkpoint pending_review, never reconciled", () => {
  const pending1 = txn({
    id: "p1",
    occurred_at: "2026-08-18T09:00:00+02:00",
    status: "pending",
    amount_rwf: 100,
  });
  const pending2 = txn({
    id: "p2",
    occurred_at: "2026-08-18T09:30:00+02:00",
    status: "pending",
    amount_rwf: 200,
  });
  const settled = txn({
    id: "s1",
    occurred_at: "2026-08-18T10:00:00+02:00",
    amount_rwf: 50,
    balance_after_rwf: 950,
  });

  const result = reconcileTransactions(
    [pending1, pending2, settled],
    { balance_rwf: 1000 },
  );

  assertEquals(result.checkpoints[0].status, "insufficient_data");
  assertEquals(result.checkpoints[1].status, "insufficient_data");
  assertEquals(result.checkpoints[2].status, "pending_review");
  assertEquals(
    result.checkpoints[2].reason,
    "unresolved_pending_transaction_in_sequence",
  );
});

Deno.test("adversarial: reconciliation's running balance correctly folds in fee effects, not just principal", () => {
  const t = txn({
    amount_rwf: 1000,
    fee_rwf: 20,
    balance_after_rwf: 3980,
  });

  const result = reconcileTransactions([t], { balance_rwf: 5000 });

  // expected = opening(5000) + net(-1020) = 3980, matching a reported
  // balance computed the same way -> reconciled, proving fee_rwf actually
  // participated in the running-balance walk (not just principal).
  assertEquals(result.checkpoints[0].expected_balance_rwf, 3980);
  assertEquals(result.checkpoints[0].reported_balance_rwf, 3980);
  assertEquals(result.checkpoints[0].status, "reconciled");
});

// ===========================================================================
// K. Repeated reconciliation processing is idempotent.
// ===========================================================================

Deno.test("K. repeated reconciliation processing produces identical results, no duplicate effects", () => {
  const transactions = [
    txn({
      id: "1",
      occurred_at: "2026-08-18T09:00:00+02:00",
      amount_rwf: 500,
      balance_after_rwf: 500,
    }),
    txn({
      id: "2",
      occurred_at: "2026-08-18T10:00:00+02:00",
      amount_rwf: 100,
      balance_after_rwf: 400,
    }),
  ];
  const opening = { balance_rwf: 1000 };

  const first = reconcileTransactions(transactions, opening);
  const second = reconcileTransactions(transactions, opening);

  assertEquals(first, second);
});
