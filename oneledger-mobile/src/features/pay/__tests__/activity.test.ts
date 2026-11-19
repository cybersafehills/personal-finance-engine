import { paymentHint, templateUsable, toPaymentRow, toTemplate } from "../activity";

const intent = (over = {}) => ({
  id: "i1",
  payment_type: "pay_person",
  state: "awaiting_verification",
  amount_minor: "5000",
  currency: "RWF",
  recipient_name: "Amy",
  recipient_msisdn_masked: "•••• ••• 4567",
  merchant_code: null,
  created_at: "2026-11-18T10:00:00Z",
  ...over,
});

describe("payment activity rows", () => {
  it("names the recipient, falling back to the masked number, merchant code or type", () => {
    expect(toPaymentRow(intent()).recipient).toBe("Amy");
    expect(toPaymentRow(intent({ recipient_name: null })).recipient).toBe("•••• ••• 4567");
    expect(toPaymentRow(intent({ recipient_name: null, recipient_msisdn_masked: null, merchant_code: "123456" })).recipient).toBe("Merchant 123456");
    expect(toPaymentRow(intent({ recipient_name: null, recipient_msisdn_masked: null, payment_type: "buy_electricity" })).recipient).toBe("Electricity");
  });
  it("reads a bigint amount sent as a string", () => {
    expect(toPaymentRow(intent()).amountMinor).toBe(5000);
  });
  it("never says a payment was paid", () => {
    expect(paymentHint(toPaymentRow(intent({ state: "awaiting_verification" })))).toBe("Person · Awaiting verification");
    expect(paymentHint(toPaymentRow(intent({ state: "something_new" })))).toMatch(/In progress/);
  });
});

describe("payment templates", () => {
  const row = (over = {}) => ({ id: "t1", name: "Rent", payment_type: "pay_merchant", default_amount_minor: "150000", recipient_snapshot: { name: "Landlord", merchant_code: "445566" }, trusted_recipient_id: null, ...over });
  it("keeps the recipient name, merchant code and usual amount", () => {
    expect(toTemplate(row())).toMatchObject({ name: "Rent", defaultAmountMinor: 150000, recipientName: "Landlord", merchantCode: "445566" });
  });
  it("copes with no amount or snapshot", () => {
    expect(toTemplate(row({ default_amount_minor: null, recipient_snapshot: null }))).toMatchObject({ defaultAmountMinor: null, recipientName: null, merchantCode: null });
  });
  it("can be filled in only for a person or a merchant", () => {
    expect(templateUsable({ type: "pay_person" })).toBe(true);
    expect(templateUsable({ type: "pay_merchant" })).toBe(true);
    expect(templateUsable({ type: "buy_airtime" })).toBe(false);
  });
});
