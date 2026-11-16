import { loadDetailExtras } from "../detail";

type Result = { data: unknown; error: unknown };
let mockTables: Record<string, Result> = {};
let mockRpcResult: Result = { data: [], error: null };
let mockUser: { id: string } | null = { id: "me" };

jest.mock("@/api/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const result = () => Promise.resolve(mockTables[table] ?? { data: null, error: { message: "missing" } });
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => result();
      chain.maybeSingle = () => result();
      // Awaited directly (no order/limit), like the split-rows read.
      chain.then = (resolve: (v: unknown) => unknown) => result().then(resolve);
      return chain;
    },
    rpc: () => Promise.resolve(mockRpcResult),
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
  },
}));

const contextRow = (kind: string) => ({
  workspace_id: "w1",
  performed_by_user_id: "me",
  record_created_by_user_id: "me",
  allocation_status: "allocated",
  category_source: "rule",
  attribution_type: null as string | null,
  attributed_user_id: null as string | null,
  workspaces: { name: "Home", kind },
  financial_sources: [{ display_name: "MTN", provider: "mtn_momo", masked_identifier: "•••• 1", owner_user_id: "me" }],
  ingestion_connections: { label: "My phone" },
});

beforeEach(() => {
  mockTables = {
    transactions: { data: contextRow("personal"), error: null },
    transaction_category_history: {
      data: [{ id: "h1", previous_category: null, new_category: "Food", decision_reason: null, actor_type: "user", created_at: "x" }],
      error: null,
    },
    transaction_tags: { data: [{ tag: "work" }, { tag: "trip" }], error: null },
  };
  mockRpcResult = { data: [{ user_id: "me", display_name: "Yves" }], error: null };
  mockUser = { id: "me" };
});

describe("loadDetailExtras", () => {
  it("reads context, history and tags (and skips members for a personal Space)", async () => {
    const extras = await loadDetailExtras("t1");
    expect(extras.context).toMatchObject({ workspaceName: "Home", workspaceKind: "personal", sourceProvider: "mtn_momo", ingestionConnectionLabel: "My phone" });
    expect(extras.history).toHaveLength(1);
    expect(extras.tags).toEqual(["work", "trip"]);
    expect(extras.members).toEqual([]);
    expect(extras.selfUserId).toBeNull();
  });

  it("also reads the member names and who you are for a household", async () => {
    mockTables.transactions = { data: contextRow("household"), error: null };
    const extras = await loadDetailExtras("t1");
    expect(extras.members).toEqual([{ userId: "me", displayName: "Yves" }]);
    expect(extras.selfUserId).toBe("me");
  });

  it("loses only the block whose read failed", async () => {
    mockTables.transaction_tags = { data: null, error: { message: "denied" } };
    mockTables.transaction_category_history = { data: null, error: { message: "denied" } };
    const extras = await loadDetailExtras("t1");
    expect(extras.tags).toEqual([]);
    expect(extras.history).toEqual([]);
    expect(extras.context?.workspaceName).toBe("Home"); // the rest is intact
  });

  it("has no context when the transaction row can't be read, without throwing", async () => {
    mockTables.transactions = { data: null, error: { message: "denied" } };
    const extras = await loadDetailExtras("t1");
    expect(extras.context).toBeNull();
    expect(extras.tags).toEqual(["work", "trip"]);
  });

  describe("attribution (household only)", () => {
    const household = (type: string | null, userId: string | null = null) => ({
      data: { ...contextRow("household"), attribution_type: type, attributed_user_id: userId },
      error: null,
    });

    it("a split reads its rows", async () => {
      mockTables.transactions = household("split");
      mockTables.transaction_member_attributions = {
        data: [{ user_id: "me", share_bps: 6000 }, { user_id: "amy", share_bps: 4000 }],
        error: null,
      };
      const extras = await loadDetailExtras("t1");
      expect(extras.attribution).toEqual({
        type: "split",
        attributedUserId: null,
        splits: [{ userId: "me", shareBps: 6000 }, { userId: "amy", shareBps: 4000 }],
      });
    });

    it("a member attribution carries who, and reads no split rows", async () => {
      mockTables.transactions = household("member", "amy");
      mockTables.transaction_member_attributions = { data: null, error: { message: "must not be read" } };
      expect((await loadDetailExtras("t1")).attribution).toEqual({ type: "member", attributedUserId: "amy", splits: [] });
    });

    it("an undecided transaction has a null type", async () => {
      mockTables.transactions = household(null);
      expect((await loadDetailExtras("t1")).attribution).toEqual({ type: null, attributedUserId: null, splits: [] });
    });

    it("has no panel (null) when a split's rows can't be read, rather than a false 'not decided yet'", async () => {
      mockTables.transactions = household("split");
      mockTables.transaction_member_attributions = { data: null, error: { message: "denied" } };
      expect((await loadDetailExtras("t1")).attribution).toBeNull();
    });

    it("has no attribution at all for a personal transaction", async () => {
      mockTables.transactions = { data: { ...contextRow("personal"), attribution_type: "shared" }, error: null };
      expect((await loadDetailExtras("t1")).attribution).toBeNull();
    });
  });
});
