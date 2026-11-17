import { distinctRecents, recentsFor, recipientsFor, toTrusted, validateNewRecipient, type TrustedRecipient } from "../recipients";

const saved = (over: Partial<TrustedRecipient>): TrustedRecipient => ({
  id: "r1", name: "Amy", kind: "phone", msisdn: "250781234567", merchantCode: null, trusted: false, relationship: null, ...over,
});

describe("distinctRecents", () => {
  const rows = [
    { recipient_name: "Amy", recipient_msisdn_masked: "•••• 4567", recipient_kind: "phone" },
    { recipient_name: "Amy", recipient_msisdn_masked: "•••• 4567", recipient_kind: "phone" },
    { recipient_name: null, recipient_msisdn_masked: null, recipient_kind: "phone" },
    { recipient_name: "Shop", recipient_msisdn_masked: null, recipient_kind: "merchant" },
  ];
  it("drops repeats and unnamed rows, keeping newest first", () => {
    expect(distinctRecents(rows).map((r) => r.name)).toEqual(["Amy", "Shop"]);
  });
  it("caps the list", () => {
    expect(distinctRecents(rows, 1)).toHaveLength(1);
  });
});

describe("what fits a payment", () => {
  it("offers numbers for a person and codes for a merchant", () => {
    const list = [saved({}), saved({ id: "r2", name: "Kigali Shop", kind: "merchant", msisdn: null, merchantCode: "123456" }), saved({ id: "r3", kind: "phone", msisdn: null })];
    expect(recipientsFor("pay_person", list).map((r) => r.id)).toEqual(["r1"]);
    expect(recipientsFor("pay_merchant", list).map((r) => r.id)).toEqual(["r2"]);
  });
  it("keeps recents of the right kind, and ones with no recorded kind", () => {
    const recents = [
      { name: "A", maskedMsisdn: null, kind: "phone" },
      { name: "B", maskedMsisdn: null, kind: "merchant" },
      { name: "C", maskedMsisdn: null, kind: null },
    ];
    expect(recentsFor("pay_person", recents).map((r) => r.name)).toEqual(["A", "C"]);
  });
  it("maps a stored row", () => {
    expect(toTrusted({ id: "1", display_name: "Amy", kind: "phone", normalized_msisdn: "250781234567", merchant_code: null, trust_status: "trusted_by_user", relationship: "Sister" }))
      .toMatchObject({ name: "Amy", trusted: true, relationship: "Sister" });
  });
});

describe("validateNewRecipient (same checks as the web)", () => {
  it("needs a name", () => {
    expect(validateNewRecipient({ name: " ", kind: "phone", number: "0781234567", trusted: false })).toEqual({ ok: false, message: "Give the recipient a name." });
  });
  it("normalises a mobile number and keeps the trust mark", () => {
    const r = validateNewRecipient({ name: "Amy", kind: "phone", number: "078 123 4567", trusted: true });
    expect(r.ok && r.row).toMatchObject({ normalized_msisdn: "250781234567", msisdn_display: "0781234567", trust_status: "trusted_by_user", merchant_code: null });
  });
  it("refuses a bad number or merchant code", () => {
    expect(validateNewRecipient({ name: "A", kind: "phone", number: "123", trusted: false }).ok).toBe(false);
    expect(validateNewRecipient({ name: "A", kind: "merchant", number: "12", trusted: false }).ok).toBe(false);
  });
  it("accepts a merchant code", () => {
    const r = validateNewRecipient({ name: "Shop", kind: "merchant", number: "123 456", trusted: false });
    expect(r.ok && r.row).toMatchObject({ merchant_code: "123456", normalized_msisdn: null, trust_status: "saved" });
  });
});
