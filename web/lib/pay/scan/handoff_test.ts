import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildScanIntentPayload,
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

Deno.test("scanTelHref: encodes # as %23, leaves * and digits literal", () => {
  assertEquals(scanTelHref("*182*1*1*250781234567*5000#"), "tel:*182*1*1*250781234567*5000%23");
});
