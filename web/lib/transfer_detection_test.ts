import { assertEquals } from "jsr:@std/assert@1";
import {
  findTransferCandidates,
  isPlausibleTransferPair,
  TransferCandidateTransaction,
} from "./transfer-detection.ts";

function txn(overrides: Partial<TransferCandidateTransaction>): TransferCandidateTransaction {
  return {
    id: "t1",
    accountId: "acc-a",
    direction: "out",
    amountMinor: 100_000n,
    occurredAt: "2026-08-15T10:00:00Z",
    currency: "RWF",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isPlausibleTransferPair
// ---------------------------------------------------------------------------

Deno.test("isPlausibleTransferPair: identical amount, same day, different accounts is plausible", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 100_000n });
  assertEquals(isPlausibleTransferPair(out, incoming), true);
});

Deno.test("isPlausibleTransferPair: same account is never a transfer", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out" });
  const incoming = txn({ id: "i1", accountId: "acc-a", direction: "in" });
  assertEquals(isPlausibleTransferPair(out, incoming), false);
});

Deno.test("isPlausibleTransferPair: different currencies are never a transfer", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", currency: "RWF" });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", currency: "EUR" });
  assertEquals(isPlausibleTransferPair(out, incoming), false);
});

Deno.test("isPlausibleTransferPair: amount within the default 2% tolerance is plausible", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 101_000n }); // 1% diff
  assertEquals(isPlausibleTransferPair(out, incoming), true);
});

Deno.test("isPlausibleTransferPair: amount beyond tolerance is not plausible", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 110_000n }); // 10% diff
  assertEquals(isPlausibleTransferPair(out, incoming), false);
});

Deno.test("isPlausibleTransferPair: within the default 24h window is plausible", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", occurredAt: "2026-08-15T10:00:00Z" });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", occurredAt: "2026-08-16T09:00:00Z" }); // 23h
  assertEquals(isPlausibleTransferPair(out, incoming), true);
});

Deno.test("isPlausibleTransferPair: beyond the default 24h window is not plausible", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", occurredAt: "2026-08-15T10:00:00Z" });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", occurredAt: "2026-08-17T10:00:00Z" }); // 48h
  assertEquals(isPlausibleTransferPair(out, incoming), false);
});

Deno.test("isPlausibleTransferPair: both must have the expected direction", () => {
  const a = txn({ id: "a", accountId: "acc-a", direction: "out" });
  const b = txn({ id: "b", accountId: "acc-b", direction: "out" });
  assertEquals(isPlausibleTransferPair(a, b), false);
});

Deno.test("isPlausibleTransferPair: custom tolerance/window options are honored", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n, occurredAt: "2026-08-15T10:00:00Z" });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 105_000n, occurredAt: "2026-08-16T20:00:00Z" });
  assertEquals(
    isPlausibleTransferPair(out, incoming, { amountTolerancePercent: 2, maxHoursApart: 24 }),
    false,
  );
  assertEquals(
    isPlausibleTransferPair(out, incoming, { amountTolerancePercent: 10, maxHoursApart: 48 }),
    true,
  );
});

// ---------------------------------------------------------------------------
// findTransferCandidates
// ---------------------------------------------------------------------------

Deno.test("findTransferCandidates: pairs a single plausible out/in pair", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 100_000n });
  const candidates = findTransferCandidates([out, incoming]);
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].outTransactionId, "o1");
  assertEquals(candidates[0].inTransactionId, "i1");
});

Deno.test("findTransferCandidates: no candidates when nothing matches", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 500_000n });
  assertEquals(findTransferCandidates([out, incoming]), []);
});

Deno.test("findTransferCandidates: an out transaction is never paired with an in on the same account", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n });
  const sameAccountIn = txn({ id: "i1", accountId: "acc-a", direction: "in", amountMinor: 100_000n });
  assertEquals(findTransferCandidates([out, sameAccountIn]), []);
});

Deno.test("findTransferCandidates: closest-in-time pair wins when one out could match multiple ins", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n, occurredAt: "2026-08-15T10:00:00Z" });
  const farIn = txn({ id: "i-far", accountId: "acc-b", direction: "in", amountMinor: 100_000n, occurredAt: "2026-08-15T22:00:00Z" });
  const closeIn = txn({ id: "i-close", accountId: "acc-c", direction: "in", amountMinor: 100_000n, occurredAt: "2026-08-15T10:30:00Z" });
  const candidates = findTransferCandidates([out, farIn, closeIn]);
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].inTransactionId, "i-close");
});

Deno.test("findTransferCandidates: each transaction is used in at most one pair, even with multiple valid matches", () => {
  const outA = txn({ id: "o-a", accountId: "acc-a", direction: "out", amountMinor: 100_000n, occurredAt: "2026-08-15T10:00:00Z" });
  const outB = txn({ id: "o-b", accountId: "acc-b", direction: "out", amountMinor: 100_000n, occurredAt: "2026-08-15T10:10:00Z" });
  const in1 = txn({ id: "i-1", accountId: "acc-c", direction: "in", amountMinor: 100_000n, occurredAt: "2026-08-15T10:05:00Z" });

  const candidates = findTransferCandidates([outA, outB, in1]);
  assertEquals(candidates.length, 1);
  // The closer-in-time out (outA, 5 min apart vs outB's ~5 min - outA is
  // exactly 5 min before, outB exactly 5 min after in1, tie broken by
  // outId string ordering) claims the only available in transaction;
  // the other out is left unmatched rather than double-booking in1.
  const claimedOut = candidates[0].outTransactionId;
  assertEquals(claimedOut === "o-a" || claimedOut === "o-b", true);
});

Deno.test("findTransferCandidates: multiple independent pairs are all found", () => {
  const out1 = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 50_000n, occurredAt: "2026-08-01T09:00:00Z" });
  const in1 = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 50_000n, occurredAt: "2026-08-01T09:05:00Z" });
  const out2 = txn({ id: "o2", accountId: "acc-b", direction: "out", amountMinor: 200_000n, occurredAt: "2026-08-10T15:00:00Z" });
  const in2 = txn({ id: "i2", accountId: "acc-a", direction: "in", amountMinor: 200_000n, occurredAt: "2026-08-10T15:02:00Z" });

  const candidates = findTransferCandidates([out1, in1, out2, in2]);
  assertEquals(candidates.length, 2);
  const pairs = candidates.map((c) => `${c.outTransactionId}->${c.inTransactionId}`).sort();
  assertEquals(pairs, ["o1->i1", "o2->i2"]);
});

Deno.test("findTransferCandidates: deterministic across repeated calls with the same input", () => {
  const out = txn({ id: "o1", accountId: "acc-a", direction: "out", amountMinor: 100_000n });
  const incoming = txn({ id: "i1", accountId: "acc-b", direction: "in", amountMinor: 100_000n });
  const a = findTransferCandidates([out, incoming]);
  const b = findTransferCandidates([out, incoming]);
  assertEquals(a, b);
});

Deno.test("findTransferCandidates: empty input yields no candidates", () => {
  assertEquals(findTransferCandidates([]), []);
});
