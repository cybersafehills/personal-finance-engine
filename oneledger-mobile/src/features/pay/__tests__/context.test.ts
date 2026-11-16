import { setRequestedWorkspace } from "@/features/spaces/request-space";

import { loadPayAgainOffer } from "../context";

const mockConfig = jest.fn();
const mockAccounts = jest.fn();
let mockRow: { data: unknown; error: unknown } = { data: null, error: null };
let mockMembership: { data: unknown; error: unknown } = { data: { role: "owner" }, error: null };
let mockSessionUser: string | null = "me";

jest.mock("@/api/mobile-api", () => ({ fetchPayConfig: () => mockConfig() }));
jest.mock("../accounts", () => ({ listPayerAccounts: () => mockAccounts() }));
jest.mock("@/api/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSessionUser ? { user: { id: mockSessionUser } } : null } }),
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve(table === "workspace_memberships" ? mockMembership : mockRow);
      return chain;
    },
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
  provider: "mtn_momo",
  ownerUserId: "me",
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
  mockMembership = { data: { role: "owner" }, error: null };
  mockSessionUser = "me";
  setRequestedWorkspace(null);
});
afterEach(() => setRequestedWorkspace(null));

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

  it("falls back to the first usable RWF account in the same Space, ignoring other Spaces and currencies", async () => {
    mockRow = row({ account_id: "gone" });
    mockAccounts.mockResolvedValue([
      acct({ id: "other-space", workspaceId: "w2" }),
      acct({ id: "euro", currency: "EUR" }),
      acct({ id: "a2", name: "Second" }),
    ]);
    expect((await loadPayAgainOffer(txn()))?.account).toEqual({ id: "a2", name: "Second" });
  });

  describe("a merchant payment's network comes from the paying account", () => {
    const merchantTxn = () => txn({ transaction_type: "merchant_payment", counterparty_reference: "123456" });

    it("won't use a bank, cash or Airtel account: the only merchant-pay code is MTN's", async () => {
      mockAccounts.mockResolvedValue([
        acct({ id: "bank", name: "Bank", provider: "bank" }),
        acct({ id: "cash", name: "Cash", provider: "cash" }),
        acct({ id: "air", name: "Airtel", provider: "airtel_money" }),
      ]);
      expect(await loadPayAgainOffer(merchantTxn())).toBeNull();
    });

    it("skips the transaction's own account when it is a bank account, and uses an MTN one", async () => {
      mockRow = row({ account_id: "bank" });
      mockAccounts.mockResolvedValue([acct({ id: "bank", name: "Bank", provider: "bank" }), acct({ id: "mtn", name: "MoMo" })]);
      expect((await loadPayAgainOffer(merchantTxn()))?.account).toEqual({ id: "mtn", name: "MoMo" });
    });
  });

  describe("a person payment's network comes from the recipient's number", () => {
    it("accepts a mobile-money account, including Airtel, but never a bank or cash one", async () => {
      mockRow = row({ account_id: "air" });
      mockAccounts.mockResolvedValue([
        acct({ id: "bank", provider: "bank" }),
        acct({ id: "air", name: "Airtel", provider: "airtel_money" }),
      ]);
      expect((await loadPayAgainOffer(txn()))?.account).toEqual({ id: "air", name: "Airtel" });

      mockAccounts.mockResolvedValue([acct({ id: "bank", provider: "bank" })]);
      expect((await loadPayAgainOffer(txn()))?.account).toBeNull();
    });
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

  describe("the Space the server will create the draft in (the active one)", () => {
    const household = (over: Record<string, unknown> = {}) =>
      row({ workspace_id: "H1", workspaces: { kind: "household" }, ...over });

    it("offers it for a transaction in the active household, paying from that household's account", async () => {
      setRequestedWorkspace("H1");
      mockRow = household();
      mockAccounts.mockResolvedValue([acct({ id: "home-acct", name: "Home MoMo", workspaceId: "H1", ownerUserId: "me" }), acct({ id: "mine", workspaceId: "w1" })]);

      const offer = await loadPayAgainOffer(txn());
      expect(offer?.account).toEqual({ id: "home-acct", name: "Home MoMo" });
    });

    it("hides it for a personal transaction while a household is active (its draft would land in the wrong Space)", async () => {
      setRequestedWorkspace("H1");
      mockRow = row(); // a personal-Space transaction
      expect(await loadPayAgainOffer(txn())).toBeNull();
    });

    it("hides it for a transaction in a different household than the active one", async () => {
      setRequestedWorkspace("H1");
      mockRow = household({ workspace_id: "H2" });
      expect(await loadPayAgainOffer(txn())).toBeNull();
    });

    it("hides it for a household transaction while the personal Space is active", async () => {
      setRequestedWorkspace(null);
      mockRow = household();
      expect(await loadPayAgainOffer(txn())).toBeNull();
    });

    it("matches the active Space by id even if its kind couldn't be read, but never guesses 'personal'", async () => {
      setRequestedWorkspace("H1");
      mockRow = { data: { account_id: "a1", workspace_id: "H1", workspaces: null }, error: null };
      mockAccounts.mockResolvedValue([acct({ workspaceId: "H1" })]);
      expect(await loadPayAgainOffer(txn())).not.toBeNull();

      setRequestedWorkspace(null);
      mockRow = { data: { account_id: "a1", workspace_id: "w1", workspaces: null }, error: null };
      expect(await loadPayAgainOffer(txn())).toBeNull(); // unknown kind with no Space requested: any doubt hides it
    });
  });

  describe("who can create the draft (a household role)", () => {
    it.each(["owner", "admin", "member"])("a %s can", async (role) => {
      mockMembership = { data: { role }, error: null };
      expect(await loadPayAgainOffer(txn())).not.toBeNull();
    });

    it("a viewer can't, so there is no button to lead to a refusal after typing an amount", async () => {
      mockMembership = { data: { role: "viewer" }, error: null };
      expect(await loadPayAgainOffer(txn())).toBeNull();
    });

    it("hides it when the role can't be read, or nobody is signed in", async () => {
      mockMembership = { data: null, error: null };
      expect(await loadPayAgainOffer(txn())).toBeNull();
      mockMembership = { data: { role: "owner" }, error: null };
      mockSessionUser = null;
      expect(await loadPayAgainOffer(txn())).toBeNull();
    });
  });

  describe("whose account it pays from", () => {
    const household = () => row({ workspace_id: "H1", workspaces: { kind: "household" } });
    beforeEach(() => {
      setRequestedWorkspace("H1");
      mockRow = household();
    });

    it("never pays from another member's account, even the one the transaction was made from", async () => {
      mockAccounts.mockResolvedValue([
        acct({ id: "a1", name: "Amy's MoMo", workspaceId: "H1", ownerUserId: "amy" }), // the transaction's own account
        acct({ id: "mine", name: "My MoMo", workspaceId: "H1", ownerUserId: "me" }),
      ]);
      expect((await loadPayAgainOffer(txn()))?.account).toEqual({ id: "mine", name: "My MoMo" });
    });

    it("hides a merchant payment when the only usable account is someone else's (it would also decide the network)", async () => {
      mockAccounts.mockResolvedValue([acct({ workspaceId: "H1", ownerUserId: "amy" })]);
      expect(
        await loadPayAgainOffer(txn({ transaction_type: "merchant_payment", counterparty_reference: "123456" })),
      ).toBeNull();
    });

    it("offers a person payment with no account at all rather than someone else's", async () => {
      mockAccounts.mockResolvedValue([acct({ workspaceId: "H1", ownerUserId: "amy" })]);
      expect((await loadPayAgainOffer(txn()))?.account).toBeNull();
    });

    it("skips an account whose owner can't be told (a source this user can't see)", async () => {
      mockAccounts.mockResolvedValue([acct({ workspaceId: "H1", ownerUserId: null })]);
      expect((await loadPayAgainOffer(txn()))?.account).toBeNull();
    });

    it("in a personal Space every account is the user's, so no owner is needed", async () => {
      setRequestedWorkspace(null);
      mockRow = row(); // a personal-Space transaction
      mockAccounts.mockResolvedValue([acct({ ownerUserId: null })]);
      expect((await loadPayAgainOffer(txn()))?.account).toEqual({ id: "a1", name: "MTN MoMo" });
    });
  });
});
