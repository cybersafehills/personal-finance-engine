import { assertEquals } from "jsr:@std/assert@1";
import {
  parseCreateIntent,
  parseHandoff,
  parseSettle,
  toMobileIntent,
} from "./mobile-pay.ts";

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

Deno.test("only person and merchant payments are accepted", () => {
  // Airtime resolves to the send-money code (it would transfer money) and bills
  // have no verified route, so neither is offered, nor is anything else.
  for (
    const paymentType of [
      "buy_airtime",
      "pay_bill",
      "buy_electricity",
      "government",
      7,
    ]
  ) {
    assertEquals(ok({ paymentType }).ok, false, String(paymentType));
  }
});

const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const merchant = (over: Record<string, unknown> = {}) =>
  parseCreateIntent({
    paymentType: "pay_merchant",
    amountMinor: 100,
    idempotencyKey: KEY,
    merchantCode: "123456",
    sourceAccountId: ACCOUNT,
    ...over,
  });

Deno.test("a person payment needs a phone number", () => {
  assertEquals(ok({ recipientMsisdn: undefined }).ok, false);
});

Deno.test("a merchant payment needs a merchant code and the paying account", () => {
  assertEquals(merchant().ok, true);
  assertEquals(merchant({ merchantCode: undefined }).ok, false);
  // No account means no way to know which network's USSD to use.
  assertEquals(merchant({ sourceAccountId: undefined }).ok, false);
  assertEquals(merchant({ sourceAccountId: "nope" }).ok, false);
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

Deno.test("a handoff is the dialer or a copy, with an outcome that fits the method", () => {
  assertEquals(parseHandoff({ method: "copy", outcome: "copied" }).ok, true);
  assertEquals(
    parseHandoff({ method: "copy", outcome: "fallback_shown" }).ok,
    true,
  );
  assertEquals(
    parseHandoff({ method: "dialer", outcome: "dialer_opened" }).ok,
    true,
  );
  assertEquals(
    parseHandoff({ method: "dialer", outcome: "dialer_unsupported" }).ok,
    true,
  );
});

Deno.test("a handoff never accepts a mismatched method/outcome, qr, or anything else", () => {
  for (
    const body of [
      { method: "dialer", outcome: "copied" },
      { method: "copy", outcome: "dialer_opened" },
      { method: "qr", outcome: "qr_shown" },
      { method: "none", outcome: "copied" },
      { method: "copy" },
      { outcome: "copied" },
      { method: "copy", outcome: 5 },
      null,
      "copy",
    ]
  ) {
    assertEquals(parseHandoff(body).ok, false, JSON.stringify(body));
  }
});

Deno.test("parseSettle: only 'sent' or 'failed'", () => {
  assertEquals(parseSettle({ outcome: "sent" }), { ok: true, value: { outcome: "sent" } });
  assertEquals(parseSettle({ outcome: "failed" }), { ok: true, value: { outcome: "failed" } });
  for (const bad of [{ outcome: "paid" }, { outcome: "" }, {}, null, "sent", { outcome: 1 }]) {
    assertEquals(parseSettle(bad).ok, false);
  }
});

Deno.test("toMobileIntent: carries when it changed and whether a provider verified it", () => {
  const base = {
    id: "i", state: "awaiting_verification", payment_type: "pay_person", provider: "mtn", currency: "RWF",
    amount_minor: 5000, recipient_name: null, recipient_msisdn_masked: null, merchant_code: null,
    billing_reference: null, expires_at: null, created_at: "2026-11-19T10:00:00Z",
  };
  assertEquals(toMobileIntent(base, null).verified, false);
  assertEquals(toMobileIntent(base, null).updatedAt, "2026-11-19T10:00:00Z");
  const verified = toMobileIntent({ ...base, verified_at: "2026-11-19T10:01:00Z", updated_at: "2026-11-19T10:01:00Z" }, null);
  assertEquals(verified.verified, true);
  assertEquals(verified.updatedAt, "2026-11-19T10:01:00Z");
});

