import { getTransactions } from "../queries";

const mockCalls: [string, ...unknown[]][] = [];

jest.mock("@/api/supabase", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      const record = (name: string) => (...args: unknown[]) => {
        mockCalls.push([name, ...args]);
        return chain;
      };
      for (const m of ["select", "neq", "eq", "is", "in", "gte", "or", "order"]) chain[m] = record(m);
      // Like the real builder: still chainable after range(), and awaitable.
      chain.range = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return chain;
    },
  },
}));

beforeEach(() => {
  mockCalls.length = 0;
});

const calls = (name: string) => mockCalls.filter(([n]) => n === name).map(([, ...args]) => args);

describe("getTransactions category filter", () => {
  it("matches a category exactly", async () => {
    await getTransactions({ category: "Food" });
    expect(calls("eq")).toContainEqual(["category", "Food"]);
    expect(calls("is")).not.toContainEqual(["category", null]);
  });

  it("treats 'Uncategorized' as no category at all, like the web", async () => {
    await getTransactions({ category: "Uncategorized" });
    expect(calls("is")).toContainEqual(["category", null]);
    expect(calls("eq").filter(([col]) => col === "category")).toEqual([]);
  });

  it("applies no category condition when none is asked for", async () => {
    await getTransactions({});
    expect(calls("eq").filter(([col]) => col === "category")).toEqual([]);
    expect(calls("is")).toEqual([]);
  });

  it("still always leaves merged duplicates out", async () => {
    await getTransactions({ category: "Food" });
    expect(calls("neq")).toContainEqual(["dedupe_state", "merged"]);
  });
});
