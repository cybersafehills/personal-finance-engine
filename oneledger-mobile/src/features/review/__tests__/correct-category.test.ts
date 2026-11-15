import { correctCategory } from "../actions";

const mockRpc = jest.fn();
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateEqs: [string, unknown][] = [];

jest.mock("@/api/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => {
      if (table !== "categorization_policies") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({ eq: () => mockSelect() }),
        }),
        insert: (row: unknown) => mockInsert(row),
        update: (fields: unknown) => {
          mockUpdate(fields);
          const chain = {
            eq: (col: string, val: unknown) => {
              mockUpdateEqs.push([col, val]);
              return mockUpdateEqs.length % 2 === 0 ? Promise.resolve({ error: null }) : chain;
            },
          };
          return chain;
        },
      };
    },
  },
}));

const TXN = { counterparty_name: "  Kigali Fresh ", workspace_id: "w1" };

beforeEach(() => {
  [mockRpc, mockSelect, mockInsert, mockUpdate].forEach((m) => m.mockReset());
  mockUpdateEqs.length = 0;
  mockRpc.mockResolvedValue({ data: TXN, error: null });
  mockSelect.mockResolvedValue({ data: [], error: null });
  mockInsert.mockResolvedValue({ error: null });
});

describe("correctCategory", () => {
  it("sends the trimmed category and the given subcategory to the database function", async () => {
    await correctCategory("t1", "  Food ", "Lunch", false);
    expect(mockRpc).toHaveBeenCalledWith("apply_manual_category_correction", {
      p_transaction_id: "t1",
      p_category: "Food",
      p_subcategory: "Lunch",
    });
  });

  it("sends null when there is no subcategory", async () => {
    await correctCategory("t1", "Food", "  ", false);
    expect(mockRpc.mock.calls[0][1].p_subcategory).toBeNull();
  });

  it("does not touch rules when the switch is off or there is no counterparty", async () => {
    expect(await correctCategory("t1", "Food", null, false)).toEqual({ ruleSaved: null });
    mockRpc.mockResolvedValue({ data: { counterparty_name: null, workspace_id: "w1" }, error: null });
    expect(await correctCategory("t1", "Food", null, true)).toEqual({ ruleSaved: null });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("inserts a workspace-scoped exact rule when none exists", async () => {
    const result = await correctCategory("t1", "Food", "Lunch", true);
    expect(result).toEqual({ ruleSaved: true });
    expect(mockInsert).toHaveBeenCalledWith({
      category: "Food",
      subcategory: "Lunch",
      rule_source: "manual",
      confidence: 1,
      priority: 10,
      is_active: true,
      workspace_id: "w1",
      match_type: "exact",
      merchant_pattern: "Kigali Fresh",
      normalized_merchant_name: "Kigali Fresh",
    });
  });

  it("updates the existing rule (matched case-insensitively), scoped to the workspace", async () => {
    mockSelect.mockResolvedValue({
      data: [
        { id: "other", merchant_pattern: "Someone Else" },
        { id: "r1", merchant_pattern: "KIGALI fresh" },
      ],
      error: null,
    });
    const result = await correctCategory("t1", "Food", null, true);
    expect(result).toEqual({ ruleSaved: true });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ category: "Food", priority: 10 }));
    expect(mockUpdateEqs).toEqual([
      ["id", "r1"],
      ["workspace_id", "w1"],
    ]);
  });

  it("treats a merchant name with wildcard characters literally", async () => {
    mockRpc.mockResolvedValue({ data: { counterparty_name: "50%*_off", workspace_id: "w1" }, error: null });
    mockSelect.mockResolvedValue({ data: [{ id: "r9", merchant_pattern: "50 cents" }], error: null });
    await correctCategory("t1", "Food", null, true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ merchant_pattern: "50%*_off" }));
  });

  it("still succeeds, reporting ruleSaved false, when the rule cannot be written", async () => {
    mockInsert.mockResolvedValue({ error: { message: "rls" } });
    expect(await correctCategory("t1", "Food", null, true)).toEqual({ ruleSaved: false });
    mockSelect.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await correctCategory("t1", "Food", null, true)).toEqual({ ruleSaved: false });
  });

  it("maps a permission failure and refuses an empty category", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "not_found_or_forbidden" } });
    await expect(correctCategory("t1", "Food", null, true)).rejects.toThrow("You can't change this transaction.");
    mockRpc.mockResolvedValue({ data: null, error: { message: "ECONNRESET" } });
    await expect(correctCategory("t1", "Food", null, true)).rejects.toThrow("Couldn't save that");
    await expect(correctCategory("t1", "  ", null, true)).rejects.toThrow("Choose a category first.");
  });
});
