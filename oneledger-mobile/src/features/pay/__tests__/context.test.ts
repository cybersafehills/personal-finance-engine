import { loadPayAgainOffer } from "../context";

const mockConfig = jest.fn();
const mockAccounts = jest.fn();
let mockRow: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock("@/api/mobile-api", () => ({ fetchPayConfig: () => mockConfig() }));
jest.mock("@/features/manual/actions", () => ({ listManualAccounts: () => mockAccounts() }));
jest.mock("@/api/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(mockRow) }) }),
    }),
  },
}));

const txn = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  transaction_type: "send_money",
  counterparty_reference: "0788123456",
  counterparty_name: "Jean",
  ...over,
});
const acct = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  name: "MTN MoMo",
  workspaceId: "w1",
  currency: "RWF",
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  data: { account_id: "a1", workspace_id: "w1", workspaces: { kind: "personal" }, ...over },
  error: null,
});

beforeEach(() => {
  mockConfig.mockReset().mockResolvedValue({ ok: true, pay: true, assistedPay: true });
  mockAccounts.mockReset().mockResolvedValue([acct()]);
  mockRow = row();
});

describe("loadPayAgainOffer", () => {
  it("offers a person payment from the transaction's own account", async () => {
    const offer = await loadPayAgainOffer(txn());
    expect(offer).toEqual({
      target: { type: "pay_person", msisdn: "250788123456", name: "Jean" },
      account: { id: "a1", name: "MTN MoMo" },
    });
  });

  it("offers a merchant payment when there is a paying account", async () => {
    const offer = await loadPayAgainOffer(txn({ transaction_type: "merchant_payment", counterparty_reference: "123456" }));
    expect(offer?.target).toMatchObject({ type: "pay_merchant", merchantCode: "123456" });
    expect(offer?.account?.id).toBe("a1");
  });

  it("asks nothing of the network for a transaction that can never offer it", async () => {
    for (const over of [{ transaction_type: "airtime" }, { counterparty_reference: "REF-7" }, { counterparty_reference: null }]) {
      expect(await loadPayAgainOffer(txn(over))).toBeNull();
    }
    expect(mockConfig).not.toHaveBeenCalled();
  });

  it("hides when assisted pay is off, or when the config can't be read", async () => {
    mockConfig.mockResolvedValue({ ok: true, pay: true, assistedPay: false });
    expect(await loadPayAgainOffer(txn())).toBeNull();
    mockConfig.mockResolvedValue({ ok: true, pay: false, assistedPay: true });
    expect(await loadPayAgainOffer(txn())).toBeNull();
    mockConfig.mockResolvedValue({ ok: false, reason: "unavailable", message: "x" });
    expect(await loadPayAgainOffer(txn())).toBeNull();
    mockConfig.mockRejectedValue(new Error("offline"));
    expect(await loadPayAgainOffer(txn())).toBeNull();
  });

  it("hides for a transaction in a shared Space (the draft would land in the personal one)", async () => {
    mockRow = row({ workspaces: { kind: "household" } });
    expect(await loadPayAgainOffer(txn())).toBeNull();
    mockRow = row({ workspaces: [{ kind: "organization" }] });
    expect(await loadPayAgainOffer(txn())).toBeNull();
  });

  it("hides when the transaction's Space can't be read", async () => {
    mockRow = { data: null, error: null };
    expect(await loadPayAgainOffer(txn())).toBeNull();
    mockRow = { data: null, error: { message: "denied" } };
    expect(await loadPayAgainOffer(txn())).toBeNull();
  });

  it("falls back to the first RWF account in the same Space, ignoring other Spaces and currencies", async () => {
    mockRow = row({ account_id: "gone" });
    mockAccounts.mockResolvedValue([
      acct({ id: "other-space", workspaceId: "w2" }),
      acct({ id: "euro", currency: "EUR" }),
      acct({ id: "a2", name: "Second" }),
    ]);
    expect((await loadPayAgainOffer(txn()))?.account).toEqual({ id: "a2", name: "Second" });
  });

  it("allows a person payment with no account, but never a merchant payment", async () => {
    mockAccounts.mockResolvedValue([]);
    expect((await loadPayAgainOffer(txn()))?.account).toBeNull();
    expect(
      await loadPayAgainOffer(txn({ transaction_type: "merchant_payment", counterparty_reference: "123456" })),
    ).toBeNull();
  });

  it("hides on any failure rather than throwing into the detail screen", async () => {
    mockAccounts.mockRejectedValue(new Error("boom"));
    expect(await loadPayAgainOffer(txn())).toBeNull();
  });
});
