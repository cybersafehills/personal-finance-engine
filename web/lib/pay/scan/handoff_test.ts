import { assert, assertEquals } from "jsr:@std/assert@1";
import { fillUssdTemplate } from "../../ussd/capability.ts";
import {
  buildScanIntentPayload,
  oneledgerProviderToDirectory,
  parseUserAmount,
  scanTelHref,
  ussdPaymentType,
  ussdProvider,
} from "./handoff.ts";

Deno.test("parseUserAmount: RWF (0-decimal) - whole numbers only", () => {
  assertEquals(parseUserAmount("5000", "RWF"), { ok: true, minor: 5000 });
  assertEquals(parseUserAmount("1,500,000", "RWF"), { ok: true, minor: 1500000 });
  assertEquals((parseUserAmount("12.50", "RWF") as { reason: string }).reason, "too_precise");
});

Deno.test("parseUserAmount: USD (2-decimal) - exact minor units, no float", () => {
  assertEquals(parseUserAmount("12.50", "USD"), { ok: true, minor: 1250 });
  assertEquals(parseUserAmount("0.09", "USD"), { ok: true, minor: 9 });
  assertEquals(parseUserAmount("1000", "USD"), { ok: true, minor: 100000 });
  assertEquals((parseUserAmount("1.005", "USD") as { reason: string }).reason, "too_precise");
});

Deno.test("parseUserAmount: rejects empty / non-numeric / zero / negative / huge", () => {
  assertEquals(parseUserAmount("", "RWF"), { ok: false, reason: "required" });
  assertEquals(parseUserAmount("abc", "RWF"), { ok: false, reason: "not_a_number" });
  assertEquals(parseUserAmount("-5", "RWF"), { ok: false, reason: "not_a_number" });
  assertEquals(parseUserAmount("0", "RWF"), { ok: false, reason: "not_positive" });
  assertEquals(parseUserAmount("0.00", "USD"), { ok: false, reason: "not_positive" });
  assertEquals(parseUserAmount("9999999999999", "RWF"), { ok: false, reason: "too_large" });
});

Deno.test("ussdPaymentType: intent wins, then category, then a safe default", () => {
  assertEquals(ussdPaymentType("mobile_money", "send_money"), "pay_person");
  assertEquals(ussdPaymentType("airtime_data", "buy_airtime"), "buy_airtime");
  assertEquals(ussdPaymentType("utilities", null), "buy_electricity");
  assertEquals(ussdPaymentType("government", null), "government");
  assertEquals(ussdPaymentType("taxes", null), "government");
  assertEquals(ussdPaymentType(null, null), "pay_merchant");
});

Deno.test("oneledgerProviderToDirectory: maps momo slugs, null for the rest", () => {
  for (const s of ["mtn", "mtn_momo", "MTN-MoMo", "momo", "mtnrwanda"]) {
    assertEquals(oneledgerProviderToDirectory(s), "mtn", s);
  }
  for (const s of ["airtel", "airtel_money", "Airtel Rwanda"]) {
    assertEquals(oneledgerProviderToDirectory(s), "airtel", s);
  }
  for (const s of ["bk", "equity", "visa", "cash", ""]) {
    assertEquals(oneledgerProviderToDirectory(s), null, s);
  }
});

Deno.test("ussdProvider: network first, then a bank label, else other", () => {
  assertEquals(ussdProvider(["mtn"], "MTN Rwanda"), "mtn");
  assertEquals(ussdProvider(["airtel"], null), "airtel");
  assertEquals(ussdProvider([], "Bank of Kigali"), "bank");
  assertEquals(ussdProvider([], "Irembo"), "other");
});

Deno.test("buildScanIntentPayload: carries source=qr_scan and only scan-legit fields", () => {
  const p = buildScanIntentPayload({
    workspaceId: "ws-1",
    idempotencyKey: "qr:abc",
    serviceCodeId: "sc-1",
    paymentType: "pay_person",
    provider: "mtn",
    amountMinor: 5000,
    currency: "RWF",
    ussdRedactedTemplate: "*182*1*1*{phone}*{amount}#",
    category: "mobile_money",
    note: null,
    recipientMsisdnNormalized: "250781234567",
    recipientMsisdnMasked: "•••• ••• 4567",
    merchantCode: null,
    ttlHours: 24,
    sessionFresh: true,
  });
  assertEquals(p.source, "qr_scan");
  assertEquals(p.amount_minor, 5000);
  assertEquals(p.recipient_kind, "phone");
  assertEquals(p.ussd_string_redacted, "*182*1*1*{phone}*{amount}#");
  // never a filled dial string / PIN
  assert(!("dial" in p) && !("pin" in p));
});

Deno.test("OneLedger -> USSD fill: merchant + amount into the seeded pay-merchant template", () => {
  // Mirrors what prepareOneLedgerHandoff does with the
  // 20260911000000 seed's params.
  const schema = [
    { key: "merchant", kind: "merchant_code" as const, required: true, formatRegex: "^[0-9]{3,12}$" },
    { key: "amount", kind: "amount" as const, required: true, formatRegex: "^[1-9][0-9]{1,6}$" },
  ];
  const ok = fillUssdTemplate(
    "*182*8*1*{merchant}*{amount}#",
    { merchant: "123456", amount: "5000" },
    schema,
  );
  assert(ok.ok);
  assertEquals(ok.dial, "*182*8*1*123456*5000#");

  // A non-numeric merchant id (allowed by the OneLedger schema, not by a
  // USSD merchant_code field) is refused - the hand-off stays unavailable.
  const bad = fillUssdTemplate(
    "*182*8*1*{merchant}*{amount}#",
    { merchant: "KGL-COFFEE", amount: "5000" },
    schema,
  );
  assert(!bad.ok);
});

Deno.test("scanTelHref: encodes # as %23, leaves * and digits literal", () => {
  assertEquals(scanTelHref("*182*1*1*250781234567*5000#"), "tel:*182*1*1*250781234567*5000%23");
});
