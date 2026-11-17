import { createKeyTracker, newRequestId } from "../key";
import { stateLabel } from "../messages";
import { parseConfigResponse, parseIntentResponse } from "../parse";
import { accountNetwork, formatLocalMsisdn, maskMsisdn, normalizeRwandaMsisdn, payAgainTarget } from "../target";

const txn = (over: Record<string, unknown> = {}) => ({
  transaction_type: "send_money",
  counterparty_reference: "0788123456",
  counterparty_name: "Jean",
  ...over,
});

describe("normalizeRwandaMsisdn", () => {
  it("accepts the four ways a Rwandan mobile number is written", () => {
    for (const input of ["0788123456", "788123456", "250788123456", "+250 788 123 456"]) {
      expect(normalizeRwandaMsisdn(input)).toBe("250788123456");
    }
  });
  it("rejects landlines, other countries, masks and junk", () => {
    for (const input of ["0221234567", "0688123456", "+14155550123", "07881", "0788****56", "", "abc"]) {
      expect(normalizeRwandaMsisdn(input)).toBeNull();
    }
  });
  it("masks all but the last four digits", () => {
    expect(maskMsisdn("250788123456")).toBe("•••• ••• 3456");
  });
});

describe("accountNetwork / formatLocalMsisdn", () => {
  it("maps an account provider to a mobile network, and bank/cash/unknown to none", () => {
    expect(accountNetwork("mtn_momo")).toBe("mtn");
    expect(accountNetwork("MTN")).toBe("mtn");
    expect(accountNetwork("airtel_money")).toBe("airtel");
    for (const provider of ["bank", "card", "cash", "other", "", null, undefined]) {
      expect(accountNetwork(provider)).toBeNull();
    }
  });
  it("shows the whole number the way the web does", () => {
    expect(formatLocalMsisdn("250788123456")).toBe("078 812 3456");
  });
});

describe("payAgainTarget", () => {
  it("offers a person for send_money with a valid number", () => {
    expect(payAgainTarget(txn())).toEqual({ type: "pay_person", msisdn: "250788123456", name: "Jean" });
  });
  it("offers a merchant for merchant_payment with a 3-12 digit code", () => {
    expect(payAgainTarget(txn({ transaction_type: "merchant_payment", counterparty_reference: "123456" }))).toEqual({
      type: "pay_merchant",
      merchantCode: "123456",
      name: "Jean",
    });
  });
  it("never offers airtime or bills (no safe verified route)", () => {
    for (const transaction_type of ["airtime", "bill_payment", "electricity", "money_received", "withdrawal"]) {
      expect(payAgainTarget(txn({ transaction_type }))).toBeNull();
    }
  });
  it("needs a usable reference", () => {
    expect(payAgainTarget(txn({ counterparty_reference: null }))).toBeNull();
    expect(payAgainTarget(txn({ counterparty_reference: "   " }))).toBeNull();
    expect(payAgainTarget(txn({ counterparty_reference: "REF-7" }))).toBeNull();
    expect(payAgainTarget(txn({ transaction_type: "merchant_payment", counterparty_reference: "REF-7" }))).toBeNull();
    expect(payAgainTarget(txn({ transaction_type: "merchant_payment", counterparty_reference: "12" }))).toBeNull();
  });
  it("keeps a missing name as null", () => {
    expect(payAgainTarget(txn({ counterparty_name: null }))?.name).toBeNull();
  });
});

describe("request id", () => {
  it("looks like a v4 UUID", () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("is the same for the same request and new when the request changes", () => {
    let n = 0;
    const tracker = createKeyTracker(() => `key-${++n}`);
    expect(tracker.keyFor("person|0788|5000")).toBe("key-1");
    expect(tracker.keyFor("person|0788|5000")).toBe("key-1"); // a retry or double tap
    expect(tracker.keyFor("person|0788|6000")).toBe("key-2"); // an edited amount must NOT reuse the old intent
    expect(tracker.keyFor("person|0788|6000")).toBe("key-2");
    expect(tracker.keyFor("person|0788|5000")).toBe("key-3"); // back to an earlier value is still a new ask
  });
});

describe("parseConfigResponse", () => {
  it("reads the pay flags and treats anything else as off", () => {
    expect(parseConfigResponse(200, { ok: true, config: { pay: true, assistedPay: true, ussdDirectory: true, bills: true } })).toEqual({
      ok: true,
      pay: true,
      assistedPay: true,
      ussdDirectory: true,
      scanToPay: false,
      trustedRecipients: false,
    });
    expect(parseConfigResponse(200, { ok: true, config: { pay: true } })).toMatchObject({ ok: true, assistedPay: false });
  });
  it("is a failure on any error, so the caller hides the button", () => {
    expect(parseConfigResponse(404, null).ok).toBe(false);
    expect(parseConfigResponse(401, null).ok).toBe(false);
    expect(parseConfigResponse(200, { ok: true }).ok).toBe(false);
  });
});

const intentBody = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  state: "draft",
  paymentType: "pay_person",
  provider: "mtn",
  currency: "RWF",
  amountMinor: 5000,
  recipientName: "Jean",
  recipientMasked: "•••• ••• 3456",
  merchantCode: null,
  expiresAt: "2026-11-17T10:00:00Z",
  instruction: { ok: true, display: "*182*1*1*0788123456*5000#", telHref: "tel:*182*1*1*0788123456*5000%23" },
  ...over,
});

describe("parseIntentResponse", () => {
  it("parses a prepared intent with its instruction", () => {
    const r = parseIntentResponse(200, { ok: true, intent: intentBody(), existed: true });
    expect(r.ok && r.existed).toBe(true);
    expect(r.ok && r.intent.instruction).toEqual({
      ok: true,
      display: "*182*1*1*0788123456*5000#",
      telHref: "tel:*182*1*1*0788123456*5000%23",
    });
  });
  it("keeps 'no verified route' as null and a fill failure as an error line", () => {
    expect(parseIntentResponse(200, { ok: true, intent: intentBody({ instruction: null }) }).ok).toBe(true);
    const r = parseIntentResponse(200, { ok: true, intent: intentBody({ instruction: { ok: false, error: "Enter a merchant code." } }) });
    expect(r.ok && r.intent.instruction).toEqual({ ok: false, error: "Enter a merchant code." });
  });
  it("never accepts a link that is not a tel: link", () => {
    for (const telHref of ["https://evil.test", "javascript:alert(1)", "sms:123"]) {
      const r = parseIntentResponse(200, { ok: true, intent: intentBody({ instruction: { ok: true, display: "x", telHref } }) });
      expect(r.ok && r.intent.instruction).toBeNull();
    }
  });
  it("reports a missing or unavailable intent", () => {
    expect(parseIntentResponse(200, { ok: true, intent: null, reason: "not_found" })).toMatchObject({ ok: false, reason: "not_found" });
    expect(parseIntentResponse(200, { ok: true, intent: null, reason: "unavailable" })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseIntentResponse(404, { ok: false, error: "not_found" })).toMatchObject({ ok: false, reason: "not_found" });
  });
  it("passes a user-safe 4xx message through, and is generic otherwise", () => {
    expect(parseIntentResponse(422, { ok: false, error: "invalid_request", message: "Enter an amount greater than zero." })).toEqual({
      ok: false,
      reason: "error",
      message: "Enter an amount greater than zero.",
    });
    expect(parseIntentResponse(500, null).ok).toBe(false);
    expect(parseIntentResponse(401, null)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseIntentResponse(200, { ok: true, intent: { id: "x" } })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("stateLabel", () => {
  it("never reads as a success", () => {
    expect(stateLabel("draft")).toBe("Draft");
    expect(stateLabel("awaiting_verification")).toBe("Awaiting verification");
    for (const state of ["successful", "completed", "verified", "who-knows"]) {
      expect(stateLabel(state)).toBe("In progress");
    }
  });
});
