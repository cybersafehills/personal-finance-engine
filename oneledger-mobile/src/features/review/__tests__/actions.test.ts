import { confirmCategory, dismissSuggestion, ReviewActionError } from "../actions";

const mockRpc = jest.fn();
jest.mock("@/api/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

beforeEach(() => mockRpc.mockReset());

describe("review actions", () => {
  it("calls the confirm function with the transaction id", async () => {
    mockRpc.mockResolvedValue({ error: null });
    await confirmCategory("t1");
    expect(mockRpc).toHaveBeenCalledWith("confirm_transaction_category", { p_transaction_id: "t1" });
  });

  it("calls the dismiss function with the transaction id", async () => {
    mockRpc.mockResolvedValue({ error: null });
    await dismissSuggestion("t2");
    expect(mockRpc).toHaveBeenCalledWith("dismiss_suggested_category", { p_transaction_id: "t2" });
  });

  it("explains a permission failure without leaking the database error", async () => {
    mockRpc.mockResolvedValue({ error: { message: "not_found_or_forbidden" } });
    await expect(confirmCategory("t1")).rejects.toThrow("You can't change this transaction.");
  });

  it("reports any other failure as a retryable error", async () => {
    mockRpc.mockResolvedValue({ error: { message: "fetch failed: ECONNRESET at host" } });
    const err = await dismissSuggestion("t1").catch((e) => e);
    expect(err).toBeInstanceOf(ReviewActionError);
    expect(err.message).toBe("Couldn't save that. Check your connection and try again.");
  });
});
