import { assertEquals } from "jsr:@std/assert@1";
import { parseCreateIntent, toMobileIntent } from "./mobile-pay.ts";

const KEY = "11111111-1111-4111-8111-111111111111";
const ok = (over: Record<string, unknown> = {}) =>
  parseCreateIntent({
    paymentType: "pay_person",
    amountMinor: 5000,
    idempotencyKey: KEY,
    recipientMsisdn: "0788123456",
    ...over,
  });

Deno.test("a valid person payment parses", () => {
  const r = ok({ recipientName: "  Jean  " });
  assertEquals(r.ok && r.value.recipientName, "Jean");
  assertEquals(r.ok && r.value.amountMinor, 5000);
});

Deno.test("the amount must be a positive whole number within range", () => {
  for (const amountMinor of [0, -5, 12.5, "5000", null, 1_000_000_000]) {
    assertEquals(ok({ amountMinor }).ok, false);
  }
  assertEquals(ok({ amountMinor: 999_999_999 }).ok, true);
});

Deno.test("a request id is required and must be a UUID", () => {
  assertEquals(ok({ idempotencyKey: undefined }).ok, false);
  assertEquals(ok({ idempotencyKey: "not-a-uuid" }).ok, false);
});

Deno.test("only the app's pay-again types are accepted", () => {
  assertEquals(ok({ paymentType: "buy_electricity" }).ok, false);
  assertEquals(ok({ paymentType: "government" }).ok, false);
  assertEquals(ok({ paymentType: 7 }).ok, false);
});

Deno.test("the recipient detail must match the payment type", () => {
  assertEquals(ok({ recipientMsisdn: undefined }).ok, false);
  assertEquals(
    parseCreateIntent({
      paymentType: "pay_merchant",
      amountMinor: 100,
      idempotencyKey: KEY,
    }).ok,
    false,
  );
  assertEquals(
    parseCreateIntent({
      paymentType: "pay_merchant",
      amountMinor: 100,
      idempotencyKey: KEY,
      merchantCode: "123456",
    }).ok,
    true,
  );
  assertEquals(
    parseCreateIntent({
      paymentType: "pay_bill",
      amountMinor: 100,
      idempotencyKey: KEY,
    }).ok,
    false,
  );
});

Deno.test("oversized or non-text recipient fields are rejected", () => {
  assertEquals(ok({ recipientName: "x".repeat(81) }).ok, false);
  assertEquals(ok({ recipientName: 5 }).ok, false);
  assertEquals(ok({ sourceAccountId: "nope" }).ok, false);
});

Deno.test("unknown fields (note, category, budget...) are ignored, not passed on", () => {
  const r = ok({
    note: "hi",
    category: "Food",
    budgetId: KEY,
    trustedRecipientId: KEY,
  });
  assertEquals(r.ok && Object.keys(r.value).sort(), [
    "amountMinor",
    "billingReference",
    "idempotencyKey",
    "merchantCode",
    "paymentType",
    "recipientMsisdn",
    "recipientName",
    "sourceAccountId",
  ]);
});

Deno.test("a non-object body is rejected", () => {
  for (const body of [null, "x", 5, undefined]) {
    assertEquals(parseCreateIntent(body).ok, false);
  }
});

const intent = {
  id: "i1",
  state: "draft",
  payment_type: "pay_person",
  provider: "mtn",
  currency: "RWF",
  amount_minor: 5000,
  recipient_name: "Jean",
  recipient_msisdn_masked: "•••• ••• 3456",
  merchant_code: null,
  billing_reference: null,
  expires_at: "2026-11-17T10:00:00Z",
  created_at: "2026-11-16T10:00:00Z",
};

Deno.test("a filled instruction carries the display string and an encoded tel link", () => {
  const m = toMobileIntent(intent, {
    ok: true,
    display: "*182*1*1*0788123456*5000#",
    dial: "*182*1*1*0788123456*5000#",
  });
  assertEquals(m.instruction, {
    ok: true,
    display: "*182*1*1*0788123456*5000#",
    telHref: "tel:*182*1*1*0788123456*5000%23",
  });
  assertEquals(m.recipientMasked, "•••• ••• 3456");
});

Deno.test("no verified route is null, and a fill failure is reported", () => {
  assertEquals(toMobileIntent(intent, null).instruction, null);
  assertEquals(
    toMobileIntent(intent, { ok: false, error: "Enter a merchant code." })
      .instruction,
    {
      ok: false,
      error: "Enter a merchant code.",
    },
  );
});

Deno.test("the full phone number never appears in the payload except inside the instruction", () => {
  const json = JSON.stringify(toMobileIntent(intent, null));
  assertEquals(json.includes("250788123456"), false);
  assertEquals(json.includes("0788123456"), false);
});
