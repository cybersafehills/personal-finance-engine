import { assertEquals } from "jsr:@std/assert@1";
import {
  matchTransactionToIntents,
  normalizeRwMsisdn,
  type ReconIntent,
  type ReconTransaction,
} from "../payment-reconciliation.ts";

const T0 = "2026-08-27T10:00:00.000Z";
const T_PLUS_2MIN = "2026-08-27T10:02:00.000Z";
const T_PLUS_2H = "2026-08-27T12:00:00.000Z";
const T_MINUS_1H = "2026-08-27T09:00:00.000Z";

function txn(over: Partial<ReconTransaction> = {}): ReconTransaction {
  return {
    id: "t1",
    workspace_id: "w1",
    direction: "out",
    status: "success",
    currency: "RWF",
    amount_rwf: 5000,
    counterparty_reference: "0781234567",
    occurred_at: T_PLUS_2MIN,
    source: "mtn_momo",
    ...over,
  };
}

function intent(over: Partial<ReconIntent> = {}): ReconIntent {
  return {
    id: "i1",
    workspace_id: "w1",
    state: "awaiting_verification",
    linked_transaction_id: null,
    amount_minor: 5000,
    recipient_msisdn_normalized: "250781234567",
    provider: "mtn",
    created_at: T0,
    expires_at: null,
    ...over,
  };
}

Deno.test("normalizeRwMsisdn: mirrors the SQL/app rule", () => {
  assertEquals(normalizeRwMsisdn("0781234567"), "250781234567");
  assertEquals(normalizeRwMsisdn("250781234567"), "250781234567");
  assertEquals(normalizeRwMsisdn("+250 78 123 4567"), "250781234567");
  assertEquals(normalizeRwMsisdn("0601234567"), null);
  assertEquals(normalizeRwMsisdn(null), null);
});

Deno.test("a single deterministic match links", () => {
  assertEquals(matchTransactionToIntents(txn(), [intent()]), {
    status: "linked",
    intentId: "i1",
  });
});

Deno.test("amount mismatch -> no match", () => {
  assertEquals(
    matchTransactionToIntents(txn({ amount_rwf: 4999 }), [intent()]).status,
    "no_match",
  );
});

Deno.test("msisdn mismatch -> no match", () => {
  assertEquals(
    matchTransactionToIntents(txn({ counterparty_reference: "0788888888" }), [
      intent(),
    ]).status,
    "no_match",
  );
});

Deno.test("outside the time window (before, and long after) -> no match", () => {
  assertEquals(
    matchTransactionToIntents(txn({ occurred_at: T_MINUS_1H }), [intent()])
      .status,
    "no_match",
  );
  assertEquals(
    matchTransactionToIntents(
      txn({ occurred_at: "2026-08-29T10:00:00.000Z" }),
      [intent()],
    ).status,
    "no_match",
  );
});

Deno.test("within an explicit expires_at window -> links", () => {
  assertEquals(
    matchTransactionToIntents(txn({ occurred_at: T_PLUS_2H }), [
      intent({ expires_at: "2026-08-27T13:00:00.000Z" }),
    ]).status,
    "linked",
  );
});

Deno.test("provider disagreement is not a match", () => {
  assertEquals(
    matchTransactionToIntents(txn({ source: "bank_card" }), [
      intent({ provider: "mtn" }),
    ]).status,
    "no_match",
  );
  // A null-provider intent tolerates any source.
  assertEquals(
    matchTransactionToIntents(txn({ source: "bank_card" }), [
      intent({ provider: null }),
    ]).status,
    "linked",
  );
});

Deno.test("two candidate intents -> conflict, never a guess", () => {
  const r = matchTransactionToIntents(txn(), [
    intent({ id: "a" }),
    intent({ id: "b" }),
  ]);
  assertEquals(r, { status: "conflict", intentIds: ["a", "b"] });
});

Deno.test("a non-open or already-linked intent is ignored", () => {
  assertEquals(
    matchTransactionToIntents(txn(), [intent({ state: "successful" })]).status,
    "no_match",
  );
  assertEquals(
    matchTransactionToIntents(txn(), [intent({ linked_transaction_id: "tx" })])
      .status,
    "no_match",
  );
});

Deno.test("a non-outgoing / non-RWF / already-linked transaction is skipped", () => {
  assertEquals(
    matchTransactionToIntents(txn({ direction: "in" }), [intent()]).status,
    "skipped",
  );
  assertEquals(
    matchTransactionToIntents(txn({ currency: "USD" }), [intent()]).status,
    "skipped",
  );
  assertEquals(
    matchTransactionToIntents(txn({ already_linked: true }), [intent()]).status,
    "skipped",
  );
});
