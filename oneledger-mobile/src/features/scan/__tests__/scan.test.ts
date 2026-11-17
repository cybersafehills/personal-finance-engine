import { dialFromTel, describeScan, parseUserAmount, REASON_MESSAGES } from "../review";
import { parseClassifyResponse, parsePrepareResponse } from "../parse";
import type { ScanModel } from "../types";

const ussd = (over: Partial<ScanModel> = {}): ScanModel => ({
  class: "verified_ussd",
  route: { kind: "ussd", template: "*182*1*1*{phone}*{amount}#", literal: "*182*1*1*0788123456*1500#" },
  providerLabel: "MTN",
  providerVerified: true,
  recipientMasked: "•••• ••• 3456",
  amount: { minor: 1500, currency: "RWF" },
  amountEditable: false,
  reference: null,
  warnings: [],
  ...over,
});
const oneledger = (over: Partial<ScanModel> = {}): ScanModel => ({
  ...ussd(),
  class: "oneledger_payment",
  route: { kind: "oneledger", provider: "mtn", merchantIdMasked: "••••12", currency: "RWF" },
  amount: null,
  amountEditable: true,
  recipientMasked: null,
  warnings: ["merchant_unverified"],
  ...over,
});

describe("describeScan", () => {
  it("a verified USSD payment is actionable and shows what it pays", () => {
    const r = describeScan(ussd());
    expect(r.isActionable).toBe(true);
    expect(r.isMenu).toBe(false);
    expect(r.needsAmount).toBe(false);
    expect(r.rows).toEqual(expect.arrayContaining([
      { label: "Opens", value: "Verified USSD code" },
      { label: "Pays", value: "•••• ••• 3456" },
      { label: "Amount", value: "RWF 1,500" },
      { label: "Code", value: "*182*1*1*0788123456*1500#" },
    ]));
  });
  it("a USSD code with no amount is a menu, not a payment", () => {
    const r = describeScan(ussd({ amount: null }));
    expect(r.isMenu).toBe(true);
    expect(r.notices.join(" ")).toMatch(/isn't a payment on its own/);
  });
  it("a OneLedger code with no amount asks for one and warns about the merchant", () => {
    const r = describeScan(oneledger());
    expect(r.needsAmount).toBe(true);
    expect(r.isActionable).toBe(true);
    expect(r.notices.join(" ")).toMatch(/can't confirm this merchant/);
  });
  it("a OneLedger code in another currency can't be continued", () => {
    const r = describeScan(oneledger({ route: { kind: "oneledger", provider: "mtn", merchantIdMasked: "••", currency: "USD" } }));
    expect(r.isActionable).toBe(false);
    expect(r.blocked).toBe("currency");
  });
  it("a provider link can't be continued from a scan", () => {
    const r = describeScan(ussd({ class: "provider_link", route: { kind: "provider_link", provider: "x", url: "https://x" } }));
    expect(r.isActionable).toBe(false);
    expect(r.blocked).toBe("route");
  });
});

describe("parseUserAmount", () => {
  it("accepts whole RWF with separators", () => {
    expect(parseUserAmount("5,000")).toEqual({ ok: true, minor: 5000 });
    expect(parseUserAmount("5 000")).toEqual({ ok: true, minor: 5000 });
  });
  it.each([["", "required"], ["abc", "not_a_number"], ["12.5", "not_a_number"], ["0", "not_positive"], ["1000000000000", "too_large"]])(
    "rejects %j as %s",
    (text, reason) => expect(parseUserAmount(text)).toEqual({ ok: false, reason }),
  );
});

describe("misc", () => {
  it("turns a tel: href back into the code", () => {
    expect(dialFromTel("tel:*182*6*1%23")).toBe("*182*6*1#");
  });
  it("has a message for every reason the server can give", () => {
    for (const reason of ["empty", "unsafe_scheme", "unknown_ussd", "lookalike_host", "oneledger_expired", "emv_unsupported", "needs_connection"]) {
      expect(REASON_MESSAGES[reason]).toBeTruthy();
    }
  });
});

describe("parseClassifyResponse", () => {
  it("reads a classified code", () => {
    const r = parseClassifyResponse(200, { ok: true, result: { ok: true, model: ussd() } });
    expect(r.ok && r.result.ok && r.result.model.class).toBe("verified_ussd");
  });
  it("reads a rejection with its reason", () => {
    expect(parseClassifyResponse(200, { ok: true, result: { ok: false, class: "suspicious", reason: "unsafe_scheme" } })).toEqual({
      ok: true,
      result: { ok: false, class: "suspicious", reason: "unsafe_scheme" },
    });
  });
  it("tells a turned-off feature from other failures", () => {
    expect(parseClassifyResponse(403, { ok: false, error: "feature_disabled" })).toMatchObject({ ok: false, disabled: true });
    expect(parseClassifyResponse(500, null)).toMatchObject({ ok: false, disabled: false });
  });
  it("refuses a malformed model instead of guessing", () => {
    expect(parseClassifyResponse(200, { ok: true, result: { ok: true, model: { class: "nope" } } }).ok).toBe(false);
  });
});

describe("parsePrepareResponse", () => {
  it("reads a prepared draft", () => {
    expect(parsePrepareResponse(200, { ok: true, outcome: { status: "prepared", intentId: "i1", telHref: "tel:*1%23", existed: true } })).toEqual({
      ok: true,
      outcome: { status: "prepared", intentId: "i1", telHref: "tel:*1%23", existed: true },
    });
  });
  it("reads an info-only route", () => {
    expect(parsePrepareResponse(200, { ok: true, outcome: { status: "info_only", telHref: "tel:*182%23" } }).ok).toBe(true);
  });
  it.each(["unsupported", "amount_required", "currency_unsupported", "feature_disabled", "error"])("reads %s", (status) => {
    expect(parsePrepareResponse(200, { ok: true, outcome: { status } })).toEqual({ ok: true, outcome: { status } });
  });
  it("refuses a prepared draft with no route, and unknown statuses", () => {
    expect(parsePrepareResponse(200, { ok: true, outcome: { status: "prepared", intentId: "i1" } }).ok).toBe(false);
    expect(parsePrepareResponse(200, { ok: true, outcome: { status: "mystery" } }).ok).toBe(false);
  });
});
