import {
  duplicateSourceLabel,
  getDuplicateContext,
  hasDuplicateTrail,
  mergedCountSentence,
  type DuplicateContext,
} from "../duplicates";

let mockSelf: { data: unknown; error: unknown } = { data: null, error: null };
let mockCanon: { data: unknown } = { data: null };
let mockChildren: { data: unknown } = { data: [] };

jest.mock("@/api/supabase", () => ({
  supabase: {
    from: () => {
      const state: { filtered?: string } = {};
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        state.filtered = cols;
        return chain;
      };
      chain.eq = (col: string) => {
        state.filtered = `${state.filtered}|${col}`;
        return chain;
      };
      chain.maybeSingle = () =>
        Promise.resolve(state.filtered?.startsWith("dedupe_state") ? mockSelf : mockCanon);
      chain.order = () => Promise.resolve(mockChildren);
      return chain;
    },
  },
}));

beforeEach(() => {
  mockSelf = { data: { dedupe_state: "unique", merged_into_transaction_id: null }, error: null };
  mockCanon = { data: null };
  mockChildren = { data: [] };
});

const ctx = (over: Partial<DuplicateContext> = {}): DuplicateContext => ({
  dedupeState: "unique",
  mergedInto: null,
  mergedDuplicates: [],
  ...over,
});

describe("getDuplicateContext", () => {
  it("is empty for an ordinary transaction", async () => {
    expect(await getDuplicateContext("t1")).toEqual({ dedupeState: "unique", mergedInto: null, mergedDuplicates: [] });
  });

  it("finds where a merged-away transaction went", async () => {
    mockSelf = { data: { dedupe_state: "merged", merged_into_transaction_id: "keep" }, error: null };
    mockCanon = { data: { id: "keep", occurred_at: "2026-11-14T10:00:00Z", counterparty_name: "Kigali Fresh" } };
    expect(await getDuplicateContext("t1")).toMatchObject({
      dedupeState: "merged",
      mergedInto: { id: "keep", occurredAt: "2026-11-14T10:00:00Z", counterparty: "Kigali Fresh" },
    });
  });

  it("lists what was merged into this one", async () => {
    mockChildren = { data: [{ id: "d1", occurred_at: "2026-11-14T10:00:00Z", counterparty_name: null, source: "statement" }] };
    expect((await getDuplicateContext("t1"))?.mergedDuplicates).toEqual([
      { id: "d1", occurredAt: "2026-11-14T10:00:00Z", counterparty: null, source: "statement" },
    ]);
  });

  it("is null when the transaction itself can't be read", async () => {
    mockSelf = { data: null, error: { message: "denied" } };
    expect(await getDuplicateContext("t1")).toBeNull();
  });
});

describe("hasDuplicateTrail", () => {
  it("is true only when there is something to say", () => {
    expect(hasDuplicateTrail(null)).toBe(false);
    expect(hasDuplicateTrail(ctx())).toBe(false);
    expect(hasDuplicateTrail(ctx({ dedupeState: "possible_duplicate" }))).toBe(true);
    expect(hasDuplicateTrail(ctx({ dedupeState: "merged", mergedInto: { id: "k", occurredAt: "x", counterparty: null } }))).toBe(true);
    expect(hasDuplicateTrail(ctx({ dedupeState: "merged" }))).toBe(false); // merged but the kept row can't be read
    expect(hasDuplicateTrail(ctx({ mergedDuplicates: [{ id: "d", occurredAt: "x", counterparty: null, source: "manual" }] }))).toBe(true);
  });
});

describe("wording", () => {
  it("labels sources and counts duplicates like the web", () => {
    expect(duplicateSourceLabel("mtn_momo")).toBe("MTN MoMo");
    expect(duplicateSourceLabel("manual")).toBe("Manual entry");
    expect(duplicateSourceLabel("statement")).toBe("Imported statement");
    expect(duplicateSourceLabel("weird")).toBe("weird");
    expect(mergedCountSentence(1)).toBe("1 duplicate was merged into this transaction");
    expect(mergedCountSentence(3)).toBe("3 duplicates were merged into this transaction");
  });
});
