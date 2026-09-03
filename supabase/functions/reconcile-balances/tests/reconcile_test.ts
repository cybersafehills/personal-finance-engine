import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  buildBalanceReconciliationRows,
  chunk,
  type LedgerTxnRow,
} from "../reconcile.ts";

let nextId = 1;

function txn(overrides: Partial<LedgerTxnRow> = {}): LedgerTxnRow {
  return {
    id: overrides.id ?? `txn-${nextId++}`,
    occurred_at: overrides.occurred_at ?? "2026-08-18T09:00:00+02:00",
    created_at: overrides.created_at ?? "2026-08-18T09:00:05+02:00",
    balance_after_rwf: overrides.balance_after_rwf ?? null,
    direction: overrides.direction ?? "out",
    status: overrides.status ?? "success",
    amount_rwf: overrides.amount_rwf ?? 0,
    fee_rwf: overrides.fee_rwf ?? 0,
  };
}

Deno.test("one row per input transaction, all stamped with the caller's account + time", () => {
  const rows = buildBalanceReconciliationRows(
    "acct-1",
    [
      txn({ amount_rwf: 100 }),
      txn({ amount_rwf: 200 }),
      txn({ amount_rwf: 300 }),
    ],
    "2026-09-01T00:00:00.000Z",
  );
  assertEquals(rows.length, 3);
  for (const r of rows) {
    assertEquals(r.account_id, "acct-1");
    assertEquals(r.calculated_at, "2026-09-01T00:00:00.000Z");
  }
});

Deno.test("a matching reported balance yields a reconciled checkpoint with full evidence", () => {
  // First txn bootstraps the running balance from its reported figure;
  // the second is then checked against it.
  const rows = buildBalanceReconciliationRows(
    "acct-1",
    [
      txn({
        id: "t1",
        amount_rwf: 0,
        direction: "neutral",
        balance_after_rwf: 1000,
      }),
      txn({
        id: "t2",
        amount_rwf: 200,
        direction: "out",
        balance_after_rwf: 800,
      }),
    ],
    "2026-09-01T00:00:00.000Z",
  );
  const t2 = rows.find((r) => r.transaction_id === "t2")!;
  assertEquals(t2.status, "reconciled");
  assertEquals(t2.expected_balance_rwf, 800);
  assertEquals(t2.reported_balance_rwf, 800);
  assertEquals(t2.difference_rwf, 0);
});

Deno.test("a disagreeing reported balance yields a mismatch carrying the signed difference", () => {
  const rows = buildBalanceReconciliationRows(
    "acct-1",
    [
      txn({
        id: "t1",
        amount_rwf: 0,
        direction: "neutral",
        balance_after_rwf: 1000,
      }),
      txn({
        id: "t2",
        amount_rwf: 200,
        direction: "out",
        balance_after_rwf: 850,
      }),
    ],
    "2026-09-01T00:00:00.000Z",
  );
  const t2 = rows.find((r) => r.transaction_id === "t2")!;
  assertEquals(t2.status, "mismatch");
  assertEquals(t2.expected_balance_rwf, 800);
  assertEquals(t2.reported_balance_rwf, 850);
  assertEquals(t2.difference_rwf, 50);
});

Deno.test("non-settling / evidence-free checkpoints are insufficient_data with null figures", () => {
  const rows = buildBalanceReconciliationRows(
    "acct-1",
    [txn({ id: "t1", amount_rwf: 500, status: "failed" })],
    "2026-09-01T00:00:00.000Z",
  );
  assertEquals(rows[0].status, "insufficient_data");
  assertEquals(rows[0].expected_balance_rwf, null);
  assertEquals(rows[0].reported_balance_rwf, null);
  assertEquals(rows[0].difference_rwf, null);
});

Deno.test("every non-insufficient_data row satisfies the table's difference-consistency invariant", () => {
  const rows = buildBalanceReconciliationRows(
    "acct-1",
    [
      txn({
        id: "t1",
        amount_rwf: 0,
        direction: "neutral",
        balance_after_rwf: 5000,
      }),
      txn({
        id: "t2",
        amount_rwf: 1000,
        direction: "out",
        balance_after_rwf: 4000,
      }),
      txn({
        id: "t3",
        amount_rwf: 250,
        direction: "out",
        balance_after_rwf: 3600,
      }),
    ],
    "2026-09-01T00:00:00.000Z",
  );
  for (const r of rows) {
    if (r.status === "insufficient_data") continue;
    assertEquals(typeof r.expected_balance_rwf, "number");
    assertEquals(typeof r.reported_balance_rwf, "number");
    assertEquals(
      r.difference_rwf,
      (r.reported_balance_rwf as number) - (r.expected_balance_rwf as number),
    );
  }
});

Deno.test("empty input yields no rows", () => {
  assertEquals(
    buildBalanceReconciliationRows("acct-1", [], "2026-09-01T00:00:00.000Z"),
    [],
  );
});

Deno.test("chunk splits evenly and handles remainders", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
  assertEquals(chunk([], 3), []);
  assertThrows(() => chunk([1], 0), RangeError);
});
