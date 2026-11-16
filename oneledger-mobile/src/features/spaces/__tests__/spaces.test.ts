import {
  isInRequestedSpace,
  echoMatches,
  kindLabel,
  requestedWorkspaceId,
  resolveActiveSpace,
  storageKey,
  type Space,
} from "../spaces";

const personal: Space = { id: "p1", name: "Personal", kind: "personal", role: "owner" };
const house: Space = { id: "h1", name: "Dolton's Household", kind: "household", role: "admin" };
const org: Space = { id: "o1", name: "Dol", kind: "organization", role: "member" };

describe("resolveActiveSpace", () => {
  it("keeps the stored choice while the user is a member", () => {
    expect(resolveActiveSpace([personal, house, org], "h1")).toBe(house);
  });

  it("falls back to the personal Space when the stored Space is gone", () => {
    expect(resolveActiveSpace([house, personal], "gone")).toBe(personal);
    expect(resolveActiveSpace([house, personal], null)).toBe(personal);
  });

  it("falls back to the first Space when there is no personal one, and to null when empty", () => {
    expect(resolveActiveSpace([house, org], null)).toBe(house);
    expect(resolveActiveSpace([], "h1")).toBeNull();
  });
});

describe("requestedWorkspaceId", () => {
  it("sends nothing for the personal Space (the server default)", () => {
    expect(requestedWorkspaceId(personal)).toBeNull();
    expect(requestedWorkspaceId(null)).toBeNull();
  });

  it("sends the id of any other Space", () => {
    expect(requestedWorkspaceId(house)).toBe("h1");
  });
});

describe("echoMatches", () => {
  it("accepts anything when no Space was requested", () => {
    expect(echoMatches(null, {})).toBe(true);
    expect(echoMatches(null, null)).toBe(true);
  });

  it("requires the server to echo the requested Space (case-insensitive)", () => {
    expect(echoMatches("AB-1", { workspace_id: "ab-1" })).toBe(true);
    expect(echoMatches("h1", { workspace_id: "p1" })).toBe(false);
    expect(echoMatches("h1", { ok: true })).toBe(false);
    expect(echoMatches("h1", null)).toBe(false);
  });
});

describe("labels and keys", () => {
  it("labels kinds like the web", () => {
    expect(kindLabel("personal")).toBe("Personal");
    expect(kindLabel("household")).toBe("Household");
    expect(kindLabel("organization")).toBe("Organization");
  });

  it("keys the remembered choice per user", () => {
    expect(storageKey("u1")).not.toBe(storageKey("u2"));
  });
});

describe("isInRequestedSpace", () => {
  const personal = { workspaceId: "p1", workspaceKind: "personal" };
  const homeA = { workspaceId: "H1", workspaceKind: "household" };

  it("with no Space requested the server uses the personal Space", () => {
    expect(isInRequestedSpace(personal, null)).toBe(true);
    expect(isInRequestedSpace(homeA, null)).toBe(false);
    expect(isInRequestedSpace({ workspaceId: "o1", workspaceKind: "organization" }, null)).toBe(false);
  });

  it("with a Space requested only a transaction in that Space qualifies", () => {
    expect(isInRequestedSpace(homeA, "H1")).toBe(true);
    expect(isInRequestedSpace(personal, "H1")).toBe(false); // a personal one viewed while a household is active
    expect(isInRequestedSpace({ workspaceId: "H2", workspaceKind: "household" }, "H1")).toBe(false); // another household
  });

  it("compares ids case-insensitively (a UUID is the same id in either case)", () => {
    expect(isInRequestedSpace({ workspaceId: "ABC-1", workspaceKind: "household" }, "abc-1")).toBe(true);
  });

  it("an unknown Space kind is never taken for the personal Space", () => {
    expect(isInRequestedSpace({ workspaceId: "x", workspaceKind: "unknown" }, null)).toBe(false);
  });
});
