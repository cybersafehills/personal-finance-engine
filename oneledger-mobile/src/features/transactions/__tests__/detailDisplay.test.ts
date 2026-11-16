import {
  attentionMessage,
  categoryReason,
  directionLabel,
  historyLine,
  memberName,
  whereFromRows,
  type TransactionContext,
} from "../detailDisplay";

const ctx = (over: Partial<TransactionContext> = {}): TransactionContext => ({
  workspaceId: "w1",
  workspaceName: "Personal",
  workspaceKind: "personal",
  sourceName: "MTN account",
  sourceProvider: "mtn_momo",
  sourceMaskedIdentifier: "•••• 4567",
  sourceOwnerUserId: "me",
  performedByUserId: "me",
  recordCreatedByUserId: "me",
  ingestionConnectionLabel: "My phone",
  allocationStatus: "allocated",
  categorySource: "rule",
  ...over,
});
const members = [
  { userId: "me", displayName: "Yves" },
  { userId: "amy", displayName: "Amy" },
  { userId: "noname", displayName: null },
];

describe("categoryReason", () => {
  it("prefers the latest recorded reason, else explains the source", () => {
    expect(categoryReason("Because you said so", "rule")).toBe("Because you said so");
    expect(categoryReason(null, "manual")).toBe("You corrected this category.");
    expect(categoryReason(null, "rule")).toBe("Matched an existing merchant rule.");
    expect(categoryReason(null, "ai")).toBe("Suggested automatically.");
    expect(categoryReason(null, "system")).toBe("Assigned by the system.");
    expect(categoryReason(null, null)).toBe("Not categorized yet.");
  });
});

describe("directionLabel / attentionMessage", () => {
  it("labels money in, out and neutral", () => {
    expect([directionLabel("in"), directionLabel("out"), directionLabel("neutral")]).toEqual([
      "Money in",
      "Money out",
      "Neutral",
    ]);
  });
  it("only speaks up when something is unsettled", () => {
    expect(attentionMessage("allocated")).toBeNull();
    expect(attentionMessage(null)).toBeNull();
    expect(attentionMessage("needs_attribution")).toMatch(/needs an attribution/);
    expect(attentionMessage("needs_space")).toMatch(/Space couldn't be determined/);
  });
});

describe("memberName", () => {
  it("uses a known name, else You, else A member, else Someone", () => {
    expect(memberName("amy", members, "me")).toBe("Amy");
    expect(memberName("noname", members, "me")).toBe("A member");
    expect(memberName("noname", members, "noname")).toBe("You");
    expect(memberName("stranger", members, "me")).toBe("A member");
    expect(memberName(null, members, "me")).toBe("Someone");
  });
});

describe("whereFromRows", () => {
  it("shows Space, From (with provider label + mask) and Imported via for a personal transaction", () => {
    expect(whereFromRows(ctx(), [], "me")).toEqual([
      { label: "Space", value: "Personal" },
      { label: "From", value: "MTN MoMo · •••• 4567" },
      { label: "Imported via", value: "My phone" },
    ]);
  });

  it("never adds household lines to a personal transaction", () => {
    const labels = whereFromRows(ctx({ performedByUserId: "amy" }), members, "me").map((r) => r.label);
    expect(labels).not.toContain("Paid by");
    expect(labels).not.toContain("Added by");
  });

  it("names who paid, who added it, and whose account in a household", () => {
    const rows = whereFromRows(
      ctx({
        workspaceKind: "household",
        workspaceName: "Home",
        sourceOwnerUserId: "amy",
        performedByUserId: "amy",
        recordCreatedByUserId: "me",
      }),
      members,
      "me",
    );
    expect(rows).toEqual([
      { label: "Space", value: "Home" },
      { label: "From", value: "MTN MoMo · •••• 4567 · Amy's account" },
      { label: "Paid by", value: "Amy" },
      { label: "Added by", value: "Yves" },
      { label: "Imported via", value: "My phone" },
    ]);
  });

  it("omits 'Added by' when the payer added it, and the owner suffix for your own account", () => {
    const rows = whereFromRows(ctx({ workspaceKind: "household", sourceOwnerUserId: "me" }), members, "me");
    expect(rows.find((r) => r.label === "From")?.value).toBe("MTN MoMo · •••• 4567");
    expect(rows.map((r) => r.label)).not.toContain("Added by");
  });

  it("falls back to the source's own name for an unknown provider and skips what is missing", () => {
    expect(
      whereFromRows(
        ctx({ sourceProvider: "mystery", sourceMaskedIdentifier: null, workspaceName: null, ingestionConnectionLabel: null }),
        [],
        "me",
      ),
    ).toEqual([{ label: "From", value: "MTN account" }]);
  });
});

describe("historyLine", () => {
  it("reads as a change by you or the system", () => {
    const base = { id: "h", decision_reason: null, created_at: "2026-11-14T10:00:00Z" };
    expect(historyLine({ ...base, previous_category: null, new_category: "Food", actor_type: "user" })).toEqual({
      change: "Uncategorized → Food",
      actor: "you",
    });
    expect(historyLine({ ...base, previous_category: "Food", new_category: null, actor_type: "rule" })).toEqual({
      change: "Food → Uncategorized",
      actor: "system",
    });
  });
});
