import { assert, assertEquals } from "jsr:@std/assert@1";
import { maskMerchantId, parseOneLedgerPayload } from "./oneledger.ts";

const NOW = Date.parse("2026-08-28T12:00:00Z");
const now = () => NOW;

function base(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    type: "merchant_payment",
    provider: "mtn_momo",
    merchant_id: "KGL-COFFEE-01",
    currency: "RWF",
    ...extra,
  });
}

Deno.test("parseOneLedgerPayload: a minimal valid payload (no amount) parses", () => {
  const r = parseOneLedgerPayload(base(), { now });
  assert(r.ok);
  assertEquals(r.value.amountMinor, null);
  assertEquals(r.value.currency, "RWF");
  assertEquals(r.value.payload.provider, "mtn_momo");
});

Deno.test("parseOneLedgerPayload: accepts the oneledger: uri prefix", () => {
  const r = parseOneLedgerPayload("oneledger:" + base({ amount_minor: 5000 }), { now });
  assert(r.ok);
  assertEquals(r.value.amountMinor, 5000);
});

Deno.test("parseOneLedgerPayload: rejects unknown top-level keys", () => {
  const r = parseOneLedgerPayload(base({ evil: 1 }), { now });
  assert(!r.ok);
  assertEquals(r.reason, "oneledger_schema");
});

Deno.test("parseOneLedgerPayload: rejects a bad version / type", () => {
  assert(!parseOneLedgerPayload(base({ v: 2 }), { now }).ok);
  const r = parseOneLedgerPayload(
    JSON.stringify({ v: 1, type: "refund", provider: "x", merchant_id: "y", currency: "RWF" }),
    { now },
  );
  assert(!r.ok);
});

Deno.test("parseOneLedgerPayload: rejects an unknown or malformed currency", () => {
  assertEquals(
    (parseOneLedgerPayload(base({ currency: "ZZZ" }), { now }) as { reason: string }).reason,
    "currency_invalid",
  );
  assertEquals(
    (parseOneLedgerPayload(base({ currency: "rwf" }), { now }) as { reason: string }).reason,
    "currency_invalid",
  );
});

Deno.test("parseOneLedgerPayload: rejects a non-integer / out-of-range amount", () => {
  for (const amount_minor of [0, -1, 1.5, 2_000_000_000_000, "5000"]) {
    const r = parseOneLedgerPayload(base({ amount_minor }), { now });
    assert(!r.ok, `expected reject for ${amount_minor}`);
    assertEquals(r.reason, "amount_invalid");
  }
});

Deno.test("parseOneLedgerPayload: rejects an expired request, accepts a future one", () => {
  const past = parseOneLedgerPayload(
    base({ expires_at: "2020-01-01T00:00:00Z" }),
    { now },
  );
  assert(!past.ok);
  assertEquals(past.reason, "oneledger_expired");

  const future = parseOneLedgerPayload(
    base({ expires_at: "2027-01-01T00:00:00Z" }),
    { now },
  );
  assert(future.ok);
  assertEquals(future.value.expiresAt, "2027-01-01T00:00:00.000Z");
});

Deno.test("parseOneLedgerPayload: rejects a replayed nonce", () => {
  const seenNonces = new Set(["abc123"]);
  const r = parseOneLedgerPayload(base({ nonce: "abc123" }), { now, seenNonces });
  assert(!r.ok);
  assertEquals(r.reason, "oneledger_replay");

  const fresh = parseOneLedgerPayload(base({ nonce: "def456" }), { now, seenNonces });
  assert(fresh.ok);
});

Deno.test("parseOneLedgerPayload: sanitises the unverified display name", () => {
  const r = parseOneLedgerPayload(
    base({ merchant_name: "Kigali Coffee" + "!".repeat(200) }),
    { now },
  );
  assert(r.ok);
  assert(r.value.merchantName!.startsWith("Kigali Coffee"));
  assert(r.value.merchantName!.length <= 80);
});

Deno.test("maskMerchantId: keeps only the last 4", () => {
  assertEquals(maskMerchantId("KGL-COFFEE-0199"), "•••• 0199");
  assertEquals(maskMerchantId("012"), "012");
});
