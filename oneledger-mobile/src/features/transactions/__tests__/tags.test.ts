import { addTag, isValidTag, listWorkspaceTags, normalizeTag, removeTag, TagError, unusedSuggestions } from "../tags";

type Result = { data?: unknown; error?: { code?: string; message: string } | null };
let mockInsertResult: Result = { error: null };
let mockDeleteResult: Result = { error: null };
let mockSelectResult: Result = { data: [], error: null };
let mockUser: { id: string } | null = { id: "me" };
const mockInsert = jest.fn();
const mockEqCalls: unknown[][] = [];

jest.mock("@/api/supabase", () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
    from: () => ({
      insert: (row: unknown) => {
        mockInsert(row);
        return Promise.resolve(mockInsertResult);
      },
      delete: () => {
        const chain: Record<string, unknown> = {};
        chain.eq = (...args: unknown[]) => {
          mockEqCalls.push(args);
          return mockEqCalls.length % 2 === 0 ? Promise.resolve(mockDeleteResult) : chain;
        };
        return chain;
      },
      select: () => {
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.order = () => chain;
        chain.limit = () => Promise.resolve(mockSelectResult);
        return chain;
      },
    }),
  },
}));

beforeEach(() => {
  mockInsertResult = { error: null };
  mockDeleteResult = { error: null };
  mockSelectResult = { data: [], error: null };
  mockUser = { id: "me" };
  mockInsert.mockReset();
  mockEqCalls.length = 0;
});

describe("tag rules", () => {
  it("normalises like the web: trim, collapse spaces, lower-case, cap at 40", () => {
    expect(normalizeTag("  Trip   To  Kigali ")).toBe("trip to kigali");
    expect(normalizeTag("x".repeat(60))).toHaveLength(40);
  });

  it("accepts letters (including accents), numbers, spaces, hyphens and underscores", () => {
    for (const tag of ["reimbursable", "trip-nairobi", "q4_2026", "école d'été".replace("'", ""), "mutuelle santé", "a b"]) {
      expect(isValidTag(tag)).toBe(true);
    }
  });

  it("rejects empty, over-long and symbol-laden tags", () => {
    for (const tag of ["", "x".repeat(41), "a#b", "tax!", "a/b", "a.b", "a,b", "a@b", "a(b)", "a+b", "a=b", "a~b"]) {
      expect(isValidTag(tag)).toBe(false);
    }
  });
});

describe("addTag", () => {
  it("stores the normalised tag against the transaction's Space, stamped with who added it", async () => {
    expect(await addTag("t1", "w1", "  Reimbursable ")).toBe("reimbursable");
    expect(mockInsert).toHaveBeenCalledWith({
      transaction_id: "t1",
      workspace_id: "w1",
      tag: "reimbursable",
      created_by: "me",
    });
  });

  it("refuses an invalid tag without touching the database", async () => {
    await expect(addTag("t1", "w1", "bad!")).rejects.toThrow("A tag is 1-40 letters, numbers, spaces, hyphens or underscores.");
    await expect(addTag("t1", "w1", "   ")).rejects.toBeInstanceOf(TagError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("treats an already-present tag as a success", async () => {
    mockInsertResult = { error: { code: "23505", message: "duplicate key" } };
    await expect(addTag("t1", "w1", "tax")).resolves.toBe("tax");
  });

  it("says plainly when the database won't allow it (e.g. a viewer)", async () => {
    mockInsertResult = { error: { code: "42501", message: "rls" } };
    await expect(addTag("t1", "w1", "tax")).rejects.toThrow("You can't change tags on this transaction.");
  });

  it("gives a generic message for any other failure, never the raw error", async () => {
    mockInsertResult = { error: { code: "XX000", message: "boom internal detail" } };
    await expect(addTag("t1", "w1", "tax")).rejects.toThrow("Couldn't add that tag. Try again.");
  });

  it("needs a signed-in user", async () => {
    mockUser = null;
    await expect(addTag("t1", "w1", "tax")).rejects.toThrow("You are not signed in.");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("removeTag", () => {
  it("deletes by transaction and normalised tag", async () => {
    await removeTag("t1", " TAX ");
    expect(mockEqCalls).toEqual([["transaction_id", "t1"], ["tag", "tax"]]);
  });

  it("reports a failure in a user-safe way", async () => {
    mockDeleteResult = { error: { message: "denied" } };
    await expect(removeTag("t1", "tax")).rejects.toThrow("Couldn't remove that tag. Try again.");
  });
});

describe("listWorkspaceTags / unusedSuggestions", () => {
  it("de-duplicates the Space's tags", async () => {
    mockSelectResult = { data: [{ tag: "a" }, { tag: "b" }, { tag: "a" }], error: null };
    expect(await listWorkspaceTags("w1")).toEqual(["a", "b"]);
  });

  it("suggests only tags not already applied, at most eight", () => {
    const all = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(unusedSuggestions(all, ["a", "b"])).toEqual(["c", "d", "e", "f", "g", "h", "i", "j"]);
    expect(unusedSuggestions(all, [])).toHaveLength(8);
    expect(unusedSuggestions(["a"], ["a"])).toEqual([]);
  });
});
