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
});
