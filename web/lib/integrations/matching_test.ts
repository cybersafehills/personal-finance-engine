import { assertEquals } from "jsr:@std/assert@1";
import {
  type CandidateTransaction,
  isReviewWorthy,
  matchNormalizedRow,
} from "./matching.ts";
import type { NormalizedImportRow } from "./mapping.ts";

function row(o: Partial<NormalizedImportRow>): NormalizedImportRow {
  return {
    occurred_at: "2026-08-10T09:00:00.000Z",
    amount_minor: 4200,
    direction: "out",
    description: "Coffee shop",
    merchant: "Coffee Shop",
    external_reference: null,
    external_transaction_id: null,
    balance_minor: null,
    currency: "RWF",
    category: null,
    ...o,
  };
}

function cand(o: Partial<CandidateTransaction>): CandidateTransaction {
  return {
    id: crypto.randomUUID(),
    amountMinor: 4200,
    currency: "RWF",
    direction: "out",
    occurredAt: "2026-08-10T09:00:30.000Z",
    counterparty: "Coffee Shop",
    externalId: null,
    externalReference: null,
    ...o,
  };
}

Deno.test("identical transaction id is an exact match", () => {
  const m = matchNormalizedRow(
    row({ external_transaction_id: "TXN-9" }),
    [cand({ externalId: "txn-9", occurredAt: "2026-01-01T00:00:00Z" })],
  );
  assertEquals(m.confidence, "exact");
  assertEquals(m.signals[0].code, "external_id");
  assertEquals(isReviewWorthy(m.confidence), true);
});

Deno.test("same amount + minute + same merchant is an exact match", () => {
  const m = matchNormalizedRow(row({}), [cand({})]);
  assertEquals(m.confidence, "exact");
});

Deno.test("same amount + minute but a different merchant is a likely match", () => {
  const m = matchNormalizedRow(
    row({ merchant: "Unrelated payee", description: null }),
    [cand({ counterparty: "Something else entirely" })],
  );
  assertEquals(m.confidence, "likely");
  assertEquals(isReviewWorthy(m.confidence), true);
});

Deno.test("same amount on the same day only is a possible match", () => {
  const m = matchNormalizedRow(
    row({ merchant: "Totally different", description: null }),
    [cand({ occurredAt: "2026-08-10T20:00:00Z", counterparty: "Also different" })],
  );
  assertEquals(m.confidence, "possible");
  assertEquals(isReviewWorthy(m.confidence), false);
});

Deno.test("nothing in common is distinct", () => {
  const m = matchNormalizedRow(row({}), [
    cand({ amountMinor: 999, occurredAt: "2025-01-01T00:00:00Z", counterparty: "X" }),
  ]);
  assertEquals(m.confidence, "distinct");
  assertEquals(m.bestCandidateId, null);
});

Deno.test("empty candidate pool is distinct", () => {
  assertEquals(matchNormalizedRow(row({}), []).confidence, "distinct");
});
