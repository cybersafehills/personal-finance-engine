import {
  buildCreateBody,
  destinationText,
  friendlyRequestError,
  isShareableLink,
  newIdempotencyKey,
  normalizeMsisdn,
  parseAmount,
  shareMessage,
  statusBadge,
  validateInput,
  type CreateInput,
} from "../input";
import { parseCandidate, parseCreateResponse, parseRequestRow } from "../parse";

const T = "ab".repeat(32);
const ok: CreateInput = { amountText: "5,000", currency: "RWF", destinationType: "momo_phone", destination: "0793000439", name: "Sam", reference: "Rent", expiresInHours: 168 };

describe("input", () => {
  it("parses amounts exactly and strictly", () => {
    expect(parseAmount("5,000", "RWF")).toBe(BigInt(5000));
    expect(parseAmount("12.50", "USD")).toBe(BigInt(1250));
    expect(parseAmount("1.005", "USD")).toBe(BigInt(101));
    for (const bad of ["", "0", "-5", "abc", "1e3", "1.2.3"]) expect(parseAmount(bad, "RWF")).toBeNull();
  });

  it("normalises Rwandan numbers like the server and rejects masked/foreign ones", () => {
    expect(normalizeMsisdn("+250 793 000 439")).toBe("250793000439");
    expect(normalizeMsisdn("0793000439")).toBe("250793000439");
    expect(normalizeMsisdn("793000439")).toBe("250793000439");
    expect(normalizeMsisdn("00250793000439")).toBe("250793000439");
    for (const bad of ["*********901", "093011", "250693000439", "25079300043", ""]) expect(normalizeMsisdn(bad)).toBeNull();
  });

  it("validates each field with a friendly message", () => {
    expect(validateInput(ok)).toEqual({});
    expect(validateInput({ ...ok, destinationType: "merchant_code", destination: "093011" })).toEqual({});
    const e = validateInput({ ...ok, amountText: "0", destination: "123", name: "  ", reference: "x".repeat(65) });
    expect(Object.keys(e).sort()).toEqual(["amount", "destination", "name", "reference"]);
    expect(validateInput({ ...ok, name: "a\u0007b" }).name).toBeDefined();
    expect(validateInput({ ...ok, destinationType: "merchant_code", destination: "12" }).destination).toMatch(/4 to 8/);
  });

  it("builds the exact server body: amount as a digit string, null reference when blank", () => {
    const b = buildCreateBody(ok, "k".repeat(32))!;
    expect(b).toEqual({
      amount_minor: "5000", currency: "RWF", destination_type: "momo_phone", destination_value: "0793000439",
      recipient_display: "Sam", reference: "Rent", expires_in_hours: 168, idempotency_key: "k".repeat(32),
    });
    expect(buildCreateBody({ ...ok, reference: "  " }, "k")!.reference).toBeNull();
    expect(buildCreateBody({ ...ok, amountText: "x" }, "k")).toBeNull();
  });

  it("idempotency keys are 32 hex characters and unique", () => {
    const rnd = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
    const a = newIdempotencyKey(rnd), b = newIdempotencyKey(rnd);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("sharing safety", () => {
  it("only an https link of exactly the expected shape is shareable", () => {
    expect(isShareableLink(`https://oneledger.me/r/${T}`)).toBe(true);
    expect(isShareableLink(`https://app.example.co.rw:8443/r/${T}`)).toBe(true);
    for (const bad of [`http://oneledger.me/r/${T}`, `https://oneledger.me/r/${T}?x=1`, `https://oneledger.me/r/${T}/x`, `https://oneledger.me/r/${T.slice(1)}`, `https://oneledger.me/r/${T.toUpperCase()}`, `javascript:alert(1)`, "", null, 5]) {
      expect(isShareableLink(bad)).toBe(false);
    }
  });
  it("the share text states amount, name and link and claims nothing", () => {
    const m = shareMessage({ amountText: "RWF 5,000", name: "Sam", url: `https://oneledger.me/r/${T}` });
    expect(m).toContain("RWF 5,000");
    expect(m).toContain("Sam");
    expect(/verified|paid/i.test(m)).toBe(false);
  });
});

describe("presentation", () => {
  it("only the owner-attested states read as paid, and 'by you' is explicit", () => {
    expect(statusBadge("open").label).toBe("Open");
    expect(statusBadge("marked_paid_by_owner").label).toBe("Marked paid by you");
    expect(/paid/i.test(statusBadge("open").label + statusBadge("expired").label + statusBadge("cancelled").label)).toBe(false);
  });
  it("formats the destination", () => {
    expect(destinationText({ destinationType: "momo_phone", destinationValue: "250793000439" })).toBe("+250 793 000 439");
    expect(destinationText({ destinationType: "merchant_code", destinationValue: "093011" })).toBe("093011");
  });
  it("maps database refusals to fixed sentences and never echoes raw text", () => {
    expect(friendlyRequestError("rate_limited")).toMatch(/wait/);
    expect(friendlyRequestError("ERROR: transaction_does_not_match")).toMatch(/exactly this amount/);
    expect(friendlyRequestError("relation payment_requests secretvalue")).not.toMatch(/secretvalue/);
  });
});

describe("parseCreateResponse", () => {
  it("accepts a good link, an idempotent replay (no link) and refuses a bad link", () => {
    expect(parseCreateResponse(200, { ok: true, id: "i1", url: `https://oneledger.me/r/${T}`, replayed: false })).toEqual({ ok: true, id: "i1", url: `https://oneledger.me/r/${T}` });
    expect(parseCreateResponse(200, { ok: true, id: "i1", url: null, replayed: true })).toEqual({ ok: true, id: "i1", url: null });
    const bad = parseCreateResponse(200, { ok: true, id: "i1", url: "https://evil.example/phish", replayed: false });
    expect(bad.ok).toBe(false);
  });
  it("passes through the server's safe message on 422 and maps other failures", () => {
    expect(parseCreateResponse(422, { ok: false, error: "payment_request_rejected", message: "Enter a valid Rwandan mobile number." })).toEqual({ ok: false, message: "Enter a valid Rwandan mobile number." });
    expect(parseCreateResponse(404, { ok: false }).ok).toBe(false);
    const f = parseCreateResponse(403, { ok: false });
    expect(!f.ok && f.reason).toBe("mfa_required");
    expect(!parseCreateResponse(400, null).ok).toBe(true);
  });
});

describe("row parsing", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "r1", workspace_id: "w1", amount_minor: 5000, currency: "RWF", destination_type: "momo_phone", destination_value: "250793000439",
    recipient_display: "Sam", reference: null, expires_at: "2026-11-22T00:00:00Z", status: "open", matched_transaction_id: null, created_at: "2026-11-15T00:00:00Z", ...over,
  });
  it("parses a row and refuses malformed ones", () => {
    expect(parseRequestRow(row())?.amountMinor).toBe(BigInt(5000));
    expect(parseRequestRow(row({ amount_minor: "9007199254740993" }))?.amountMinor).toBe(BigInt("9007199254740993"));
    for (const bad of [row({ status: "paid" }), row({ currency: "GBP" }), row({ amount_minor: 0 }), row({ amount_minor: 1.5 }), row({ destination_type: "iban" }), null, []]) {
      expect(parseRequestRow(bad)).toBeNull();
    }
  });
  it("parses candidates", () => {
    expect(parseCandidate({ id: "t1", occurred_at: "2026-11-16T00:00:00Z", counterparty_name: "Payer" })).toEqual({ id: "t1", occurredAt: "2026-11-16T00:00:00Z", counterpartyName: "Payer" });
    expect(parseCandidate({ id: "", occurred_at: "x" })).toBeNull();
  });
});
