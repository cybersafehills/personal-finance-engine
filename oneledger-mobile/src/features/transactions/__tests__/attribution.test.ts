import {
  attributionSummary,
  checkSplit,
  formatPercent,
  getMemberSplits,
  initialSplitRows,
  needsAttribution,
  percentTextToBps,
  setAttribution,
  totalLabel,
  AttributionError,
} from "../attribution";

type Result = { data?: unknown; error?: { code?: string; message: string } | null };
let mockRpcResult: Result = { error: null };
let mockSplitsResult: Result = { data: [], error: null };
const mockRpc = jest.fn();

jest.mock("@/api/supabase", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      mockRpc(fn, args);
      return Promise.resolve(mockRpcResult);
    },
    from: () => ({ select: () => ({ eq: () => Promise.resolve(mockSplitsResult) }) }),
  },
}));

beforeEach(() => {
  mockRpcResult = { error: null };
  mockSplitsResult = { data: [], error: null };
  mockRpc.mockReset();
});

const members = [
  { userId: "me", displayName: "Yves" },
  { userId: "amy", displayName: "Amy" },
  { userId: "bo", displayName: null },
];

describe("attributionSummary / needsAttribution", () => {
  it("words each kind like the web", () => {
    expect(attributionSummary({ type: "shared", attributedUserId: null, splits: [] }, members, "me")).toBe("Shared by the household");
    expect(attributionSummary({ type: "member", attributedUserId: "amy", splits: [] }, members, "me")).toBe("Amy");
    expect(attributionSummary({ type: "member", attributedUserId: "me2", splits: [] }, members, "me2")).toBe("You");
    expect(
      attributionSummary({ type: "split", attributedUserId: null, splits: [{ userId: "me", shareBps: 6000 }, { userId: "amy", shareBps: 4000 }] }, members, "me"),
    ).toBe("Yves 60% · Amy 40%");
    expect(attributionSummary({ type: null, attributedUserId: null, splits: [] }, members, "me")).toBe("Not decided yet");
    expect(attributionSummary({ type: "unassigned", attributedUserId: null, splits: [] }, members, "me")).toBe("Not decided yet");
  });

  it("flags only an undecided attribution as needing one", () => {
    expect(needsAttribution({ type: null, attributedUserId: null, splits: [] })).toBe(true);
    expect(needsAttribution({ type: "unassigned", attributedUserId: null, splits: [] })).toBe(true);
    expect(needsAttribution({ type: "shared", attributedUserId: null, splits: [] })).toBe(false);
    expect(needsAttribution({ type: "member", attributedUserId: "amy", splits: [] })).toBe(false);
  });
});

describe("split rules (whole basis points)", () => {
  it("reads a typed percentage into basis points", () => {
    expect(percentTextToBps("50")).toBe(5000);
    expect(percentTextToBps(" 33.33 ")).toBe(3333);
    expect(percentTextToBps("12.5%")).toBe(1250);
    expect(percentTextToBps("")).toBe(0);
    expect(percentTextToBps("100")).toBe(10000);
  });

  it("refuses what isn't a usable percentage", () => {
    for (const text of ["abc", "-5", "101", "12.345", "1e2", "50 50", "--"]) expect(percentTextToBps(text)).toBeNull();
  });

  it("formats basis points back to a percentage", () => {
    expect([formatPercent(5000), formatPercent(3333), formatPercent(1250), formatPercent(0)]).toEqual(["50", "33.33", "12.5", "0"]);
  });

  it("starts with one row per member, prefilled from the current split", () => {
    expect(initialSplitRows(members, [{ userId: "amy", shareBps: 2500 }])).toEqual([
      { userId: "me", percentText: "" },
      { userId: "amy", percentText: "25" },
      { userId: "bo", percentText: "" },
    ]);
  });

  it("accepts shares that add up to exactly 100% and leaves out members with none", () => {
    const check = checkSplit([{ userId: "me", percentText: "60" }, { userId: "amy", percentText: "40" }, { userId: "bo", percentText: "" }]);
    expect(check).toEqual({
      ok: true,
      totalBps: 10000,
      splits: [{ userId: "me", shareBps: 6000 }, { userId: "amy", shareBps: 4000 }],
    });
  });

  it("three equal thirds can add up (the case summing floats gets wrong)", () => {
    const check = checkSplit([{ userId: "me", percentText: "33.33" }, { userId: "amy", percentText: "33.33" }, { userId: "bo", percentText: "33.34" }]);
    expect(check.ok).toBe(true);
    expect(check.totalBps).toBe(10000);
  });

  it("says why shares can't be saved yet", () => {
    expect(checkSplit([{ userId: "me", percentText: "60" }, { userId: "amy", percentText: "30" }])).toMatchObject({ ok: false, totalBps: 9000, message: "The shares must add up to 100%." });
    expect(checkSplit([{ userId: "me", percentText: "60" }, { userId: "amy", percentText: "50" }])).toMatchObject({ ok: false, totalBps: 11000 });
    expect(checkSplit([{ userId: "me", percentText: "" }])).toMatchObject({ ok: false, message: "Give at least one member a share." });
    expect(checkSplit([{ userId: "me", percentText: "abc" }])).toMatchObject({ ok: false, message: "Enter each share as a percentage, like 50 or 33.33." });
  });

  it("allows one member to take all of it", () => {
    expect(checkSplit([{ userId: "me", percentText: "100" }, { userId: "amy", percentText: "" }]).ok).toBe(true);
  });

  it("shows a running total", () => {
    expect(totalLabel(6000)).toBe("60% of 100%");
    expect(totalLabel(3333)).toBe("33.33% of 100%");
  });
});

describe("setAttribution", () => {
  it("shared and unassigned name nobody", async () => {
    await setAttribution("t1", { type: "shared" });
    await setAttribution("t1", { type: "unassigned" });
    expect(mockRpc).toHaveBeenNthCalledWith(1, "set_transaction_attribution", { p_transaction_id: "t1", p_attribution_type: "shared", p_attributed_user_id: null, p_splits: null });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "set_transaction_attribution", { p_transaction_id: "t1", p_attribution_type: "unassigned", p_attributed_user_id: null, p_splits: null });
  });

  it("a member attribution sends the member and no split", async () => {
    expect(await setAttribution("t1", { type: "member", memberId: "amy" })).toEqual({ type: "member", attributedUserId: "amy", splits: [] });
    expect(mockRpc).toHaveBeenCalledWith("set_transaction_attribution", { p_transaction_id: "t1", p_attribution_type: "member", p_attributed_user_id: "amy", p_splits: null });
  });

  it("a split sends user_id / share_bps pairs and no single member", async () => {
    const splits = [{ userId: "me", shareBps: 6000 }, { userId: "amy", shareBps: 4000 }];
    expect(await setAttribution("t1", { type: "split", splits })).toEqual({ type: "split", attributedUserId: null, splits });
    expect(mockRpc).toHaveBeenCalledWith("set_transaction_attribution", {
      p_transaction_id: "t1",
      p_attribution_type: "split",
      p_attributed_user_id: null,
      p_splits: [{ user_id: "me", share_bps: 6000 }, { user_id: "amy", share_bps: 4000 }],
    });
  });

  it("shows the database's own plain refusal (a raised exception), as the web does", async () => {
    mockRpcResult = { error: { code: "P0001", message: "You do not have permission to categorize transactions in this Space." } };
    await expect(setAttribution("t1", { type: "shared" })).rejects.toThrow("You do not have permission to categorize transactions in this Space.");
    await expect(setAttribution("t1", { type: "shared" })).rejects.toBeInstanceOf(AttributionError);
  });

  it("never leaks any other database error", async () => {
    for (const error of [
      { code: "42501", message: "permission denied for table transactions" },
      { code: "23514", message: 'new row violates check constraint "internal_detail"' },
      { message: "fetch failed" },
      { code: "P0001", message: "x".repeat(300) },
    ]) {
      mockRpcResult = { error };
      await expect(setAttribution("t1", { type: "shared" })).rejects.toThrow("Couldn't save that. Check your connection and try again.");
    }
  });
});

describe("getMemberSplits", () => {
  it("maps the rows", async () => {
    mockSplitsResult = { data: [{ user_id: "me", share_bps: 7000 }, { user_id: "amy", share_bps: 3000 }], error: null };
    expect(await getMemberSplits("t1")).toEqual([{ userId: "me", shareBps: 7000 }, { userId: "amy", shareBps: 3000 }]);
  });

  it("throws, rather than returning nothing, when the read fails", async () => {
    mockSplitsResult = { data: null, error: { message: "denied" } };
    await expect(getMemberSplits("t1")).rejects.toThrow();
  });
});
