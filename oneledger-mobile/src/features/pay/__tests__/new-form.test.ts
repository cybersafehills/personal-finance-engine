import type { PayerAccount } from "../accounts";
import { actionAvailableHere, LAUNCHER_ACTIONS, showPayButton } from "../launcher";
import { parseRecipient, payableAccounts } from "../new-form";

const acct = (over: Partial<PayerAccount>): PayerAccount => ({
  id: "a1",
  name: "MTN MoMo",
  workspaceId: "w1",
  currency: "RWF",
  provider: "MTN MoMo",
  ownerUserId: "u1",
  ...over,
});
const ctx = { workspaceId: "w1", personal: true, userId: "u1" };

describe("parseRecipient", () => {
  it("normalises a Rwandan mobile number", () => {
    expect(parseRecipient("pay_person", "078 123 4567")).toEqual({ ok: true, msisdn: "250781234567" });
  });
  it("refuses a number the server would refuse", () => {
    expect(parseRecipient("pay_person", "12345").ok).toBe(false);
  });
  it("accepts a 3 to 12 digit merchant code, ignoring spaces", () => {
    expect(parseRecipient("pay_merchant", " 123 456 ")).toEqual({ ok: true, merchantCode: "123456" });
  });
  it("refuses a merchant code that is too short or not digits", () => {
    expect(parseRecipient("pay_merchant", "12").ok).toBe(false);
    expect(parseRecipient("pay_merchant", "12ab").ok).toBe(false);
  });
});

describe("payableAccounts", () => {
  it("keeps RWF mobile-money accounts in the active Space for a person", () => {
    const list = [acct({}), acct({ id: "b", provider: "Airtel Money" }), acct({ id: "c", provider: "Bank of Kigali" })];
    expect(payableAccounts(list, ctx, "pay_person").map((a) => a.id)).toEqual(["a1", "b"]);
  });
  it("offers only MTN for a merchant (the network comes from the account)", () => {
    const list = [acct({}), acct({ id: "b", provider: "Airtel Money" })];
    expect(payableAccounts(list, ctx, "pay_merchant").map((a) => a.id)).toEqual(["a1"]);
  });
  it("skips other currencies and other Spaces", () => {
    const list = [acct({ currency: "USD" }), acct({ id: "b", workspaceId: "w2" })];
    expect(payableAccounts(list, ctx, "pay_person")).toEqual([]);
  });
  it("in a household only counts the user's own accounts", () => {
    const list = [acct({ ownerUserId: "u2" }), acct({ id: "b", ownerUserId: null }), acct({ id: "c" })];
    expect(payableAccounts(list, { ...ctx, personal: false }, "pay_person").map((a) => a.id)).toEqual(["c"]);
  });
});

describe("launcher model", () => {
  it("shows the button only where Pay is on", () => {
    expect(showPayButton({ ok: true, pay: true })).toBe(true);
    expect(showPayButton({ ok: true, pay: false })).toBe(false);
    expect(showPayButton({ ok: false })).toBe(false);
  });
  it("prepares person and merchant here only when assisted pay is on", () => {
    const [person, , bill] = LAUNCHER_ACTIONS;
    expect(actionAvailableHere(person, { assistedPay: false })).toBe(false);
    expect(actionAvailableHere(person, { assistedPay: true })).toBe(true);
    expect(actionAvailableHere(bill, {})).toBe(true);
  });
});
