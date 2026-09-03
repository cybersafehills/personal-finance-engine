import { assert, assertEquals } from "jsr:@std/assert@1";
import { scoreTransactionMatches, type TxnCandidate } from "./score.ts";

const SUBJECT = {
  totalMinor: "141600",
  currency: "RWF",
  issueDate: "2026-08-12",
  supplierName: "Kigali Office Supplies Ltd",
  invoiceNumber: "INV-2026-0442",
};

function txn(over: Partial<TxnCandidate>): TxnCandidate {
  return {
    transactionId: over.transactionId ?? crypto.randomUUID(),
    occurredAt: "2026-08-13T09:00:00Z",
    amountMinor: "141600",
    currency: "RWF",
    counterpartyName: null,
    counterpartyReference: null,
    ...over,
  };
}

function ids(r: ReturnType<typeof scoreTransactionMatches>) {
  return r.map((x) => x.transactionId);
}

Deno.test("exact amount + currency + next day -> strong match", () => {
  const r = scoreTransactionMatches(SUBJECT, [txn({ transactionId: "t" })]);
  assertEquals(r.length, 1);
  assert(r[0].score >= 0.85);
  assert(r[0].reasonsFor.includes("exact amount"));
  assert(r[0].reasonsFor.includes("currency matches"));
  assert(r[0].reasonsFor.some((x) => x.includes("within 3 days")));
});

Deno.test("amount within 2% is a weaker 'for' reason", () => {
  const r = scoreTransactionMatches(SUBJECT, [txn({ transactionId: "t", amountMinor: "143000" })]);
  assert(r[0].reasonsFor.includes("amount within 2%"));
  assert(!r[0].reasonsFor.includes("exact amount"));
});

Deno.test("a large amount difference is a reason against and may drop below threshold", () => {
  const r = scoreTransactionMatches(SUBJECT, [
    txn({ transactionId: "t", amountMinor: "500000", occurredAt: "2026-11-01T00:00:00Z" }),
  ]);
  assertEquals(r, []);
});

Deno.test("currency mismatch penalises and is recorded against", () => {
  const r = scoreTransactionMatches(SUBJECT, [txn({ transactionId: "t", currency: "USD" })]);
  // exact amount (0.5) + within-3-days (0.25) - currency (0.3) = 0.45 -> still surfaces, with the caveat
  assert(r.length === 0 || r[0].reasonsAgainst.some((x) => x.includes("currency mismatch")));
});

Deno.test("counterparty matching the supplier and the reference matching the invoice both add", () => {
  const r = scoreTransactionMatches(SUBJECT, [
    txn({
      transactionId: "t",
      counterpartyName: "KIGALI OFFICE SUPPLIES LTD",
      counterpartyReference: "inv-2026-0442",
    }),
  ]);
  assert(r[0].reasonsFor.includes("recipient matches the supplier"));
  assert(r[0].reasonsFor.some((x) => x.includes("reference matches")));
  assertEquals(r[0].score, 1);
});

Deno.test("far-from-invoice date is a reason against", () => {
  const r = scoreTransactionMatches(SUBJECT, [
    txn({ transactionId: "t", occurredAt: "2026-06-01T00:00:00Z" }),
  ]);
  assert(r.length === 0 || r[0].reasonsAgainst.some((x) => x.includes("well after")));
});

Deno.test("candidates are sorted by score and capped at 8", () => {
  const strong = Array.from({ length: 6 }, (_, i) => txn({ transactionId: `s${i}` }));
  const weak = Array.from({ length: 6 }, (_, i) =>
    txn({ transactionId: `w${i}`, amountMinor: "143000" }),
  );
  const r = scoreTransactionMatches(SUBJECT, [...weak, ...strong]);
  assertEquals(r.length, 8);
  for (let i = 1; i < r.length; i++) assert(r[i - 1].score >= r[i].score);
  assert(ids(r).slice(0, 6).every((x) => x.startsWith("s")));
});

Deno.test("no total on the subject -> no matches", () => {
  const r = scoreTransactionMatches({ ...SUBJECT, totalMinor: null }, [txn({})]);
  // amount can't be compared; currency + date alone stay under threshold
  assertEquals(r, []);
});
