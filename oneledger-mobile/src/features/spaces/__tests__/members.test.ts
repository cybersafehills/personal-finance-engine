import {
  canChangeMembers,
  canEditRow,
  canManageInvites,
  INVITE_ROLE_OPTIONS,
  inviteExpiryLabel,
  inviteOutcomeText,
  isPlausibleEmail,
  memberLabel,
  roleLabel,
  type Member,
} from "../members";
import { parseInviteResponse, parseSimpleWrite } from "../members-parse";

const member = (over: Partial<Member> = {}): Member => ({
  membershipId: "m1",
  userId: "1a2b3c4d-0000-4000-8000-000000000000",
  role: "member",
  status: "active",
  joinedAt: "2026-09-01T10:00:00Z",
  isSelf: false,
  ...over,
});

describe("who may do what (follows the database, not the web's controls)", () => {
  it("only owners change roles or remove people", () => {
    expect(canChangeMembers("owner")).toBe(true);
    for (const r of ["admin", "member", "viewer", null, undefined]) expect(canChangeMembers(r)).toBe(false);
  });

  it("owners and admins invite and cancel invites", () => {
    expect(canManageInvites("owner")).toBe(true);
    expect(canManageInvites("admin")).toBe(true);
    expect(canManageInvites("member")).toBe(false);
    expect(canManageInvites("viewer")).toBe(false);
  });

  it("an owner can edit others but never their own row", () => {
    expect(canEditRow("owner", member())).toBe(true);
    expect(canEditRow("owner", member({ isSelf: true }))).toBe(false);
    expect(canEditRow("admin", member())).toBe(false);
  });

  it("an invite can never grant owner", () => {
    expect(INVITE_ROLE_OPTIONS.map((r) => r.value)).toEqual(["admin", "member", "viewer"]);
  });
});

describe("labels", () => {
  it("names a member: You, the directory name, or the web's Member 1a2b3c4d", () => {
    const names = new Map([["1a2b3c4d-0000-4000-8000-000000000000", " Sash "]]);
    expect(memberLabel(member({ isSelf: true }), names)).toBe("You");
    expect(memberLabel(member(), names)).toBe("Sash");
    expect(memberLabel(member(), new Map())).toBe("Member 1a2b3c4d");
    expect(memberLabel(member(), new Map([[member().userId, "  "]]))).toBe("Member 1a2b3c4d");
  });

  it("words roles and expiry", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(inviteExpiryLabel({ expired: true, expiresAt: "x" }, () => "nope")).toBe("Expired");
    expect(inviteExpiryLabel({ expired: false, expiresAt: "2026-11-20" }, (i) => i)).toBe("Expires 2026-11-20");
  });

  it("tells the inviter what happened to the email", () => {
    expect(inviteOutcomeText("a@b.co", true)).toBe("We emailed an invite to a@b.co.");
    expect(inviteOutcomeText("a@b.co", false)).toMatch(/Share the link yourself; it won't be shown again/);
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses and rejects junk and lists", () => {
    expect(isPlausibleEmail(" a@b.co ")).toBe(true);
    for (const bad of ["", "nope", "a@b", "a b@c.co", "a@b.co, c@d.co"]) expect(isPlausibleEmail(bad)).toBe(false);
  });
});

describe("write responses", () => {
  it("accepts ok, with the invite link and email outcome", () => {
    expect(parseSimpleWrite(200, { ok: true })).toEqual({ ok: true });
    expect(parseInviteResponse(200, { ok: true, link: "https://x/invite/s", emailSent: false })).toEqual({
      ok: true,
      link: "https://x/invite/s",
      emailSent: false,
    });
  });

  it("passes the server's fixed sentence through for refusals", () => {
    expect(parseSimpleWrite(403, { ok: false, error: "owner_only", message: "Only an owner can do that." })).toEqual({
      ok: false,
      reason: "error",
      message: "Only an owner can do that.",
    });
    expect(parseSimpleWrite(409, { ok: false, error: "last_owner", message: "A Space must always have at least one owner." }).ok).toBe(false);
    expect(parseSimpleWrite(404, { ok: false, error: "not_found", message: "That member isn't in this Space any more." })).toMatchObject({
      message: "That member isn't in this Space any more.",
    });
  });

  it("keeps sign-in, two-step and flag-off distinct, and never shows unknown bodies", () => {
    expect(parseSimpleWrite(401, {})).toMatchObject({ reason: "unauthorized" });
    expect(parseSimpleWrite(403, { error: "mfa_required" })).toMatchObject({ reason: "mfa_required" });
    expect(parseSimpleWrite(404, { error: "not_found" })).toMatchObject({ reason: "unavailable" });
    const generic = parseSimpleWrite(500, { message: "select * from secrets" });
    expect(generic).toMatchObject({ reason: "error" });
    expect(JSON.stringify(generic)).not.toContain("secrets");
  });
});
