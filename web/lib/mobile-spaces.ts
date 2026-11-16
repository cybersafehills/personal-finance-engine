// Pure parsing and error mapping for the mobile Space & members routes
// (POST /api/mobile/spaces/...; docs/mobile-api.md). Kept free of imports so it
// is unit-tested with `deno test` (mobile_spaces_test.ts).
//
// Every write names its Space explicitly (`workspaceId`). The web resolves the
// active Space from a cookie, and for the app's header the personal Space is the
// fallback when a requested Space is not usable; for a *write* that fallback
// would silently land the change in the wrong Space, so these routes never use it.

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
/** What an invite can grant: never owner, as on the web. */
export const INVITE_ROLES = ["admin", "member", "viewer"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type InviteRole = (typeof INVITE_ROLES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately loose: the invite email is the real check. Stops obvious junk
// and header/control characters from reaching the mailer.
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const MAX_EMAIL_LENGTH = 254;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function uuid(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;
}

export type SetRoleRequest = { workspaceId: string; membershipId: string; role: MemberRole };

export function parseSetRole(body: unknown): Parsed<SetRoleRequest> {
  if (!isRecord(body)) return { ok: false, message: "That request wasn't understood." };
  const workspaceId = uuid(body.workspaceId);
  const membershipId = uuid(body.membershipId);
  if (!workspaceId || !membershipId) return { ok: false, message: "That request wasn't understood." };
  if (!(MEMBER_ROLES as readonly unknown[]).includes(body.role)) {
    return { ok: false, message: "Choose a valid role." };
  }
  return { ok: true, value: { workspaceId, membershipId, role: body.role as MemberRole } };
}

export type RemoveRequest = { workspaceId: string; membershipId: string };

export function parseRemove(body: unknown): Parsed<RemoveRequest> {
  if (!isRecord(body)) return { ok: false, message: "That request wasn't understood." };
  const workspaceId = uuid(body.workspaceId);
  const membershipId = uuid(body.membershipId);
  if (!workspaceId || !membershipId) return { ok: false, message: "That request wasn't understood." };
  return { ok: true, value: { workspaceId, membershipId } };
}

export type CreateInviteRequest = { workspaceId: string; email: string; role: InviteRole };

export function parseCreateInvite(body: unknown): Parsed<CreateInviteRequest> {
  if (!isRecord(body)) return { ok: false, message: "That request wasn't understood." };
  const workspaceId = uuid(body.workspaceId);
  if (!workspaceId) return { ok: false, message: "That request wasn't understood." };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return { ok: false, message: "Enter an email address." };
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (!(INVITE_ROLES as readonly unknown[]).includes(body.role)) {
    return { ok: false, message: "Choose a valid role." };
  }
  return { ok: true, value: { workspaceId, email, role: body.role as InviteRole } };
}

export type RevokeInviteRequest = { workspaceId: string; inviteId: string };

export function parseRevokeInvite(body: unknown): Parsed<RevokeInviteRequest> {
  if (!isRecord(body)) return { ok: false, message: "That request wasn't understood." };
  const workspaceId = uuid(body.workspaceId);
  const inviteId = uuid(body.inviteId);
  if (!workspaceId || !inviteId) return { ok: false, message: "That request wasn't understood." };
  return { ok: true, value: { workspaceId, inviteId } };
}

export type RpcFailure = { status: 403 | 404 | 409 | 422; code: string; message: string };

/**
 * Maps a database exception from set_member_role / remove_member to a fixed,
 * user-facing sentence (the web action returns the raw database text; the app
 * never should). Unknown errors get a generic line.
 */
export function mapMemberRpcError(raw: string | null | undefined): RpcFailure {
  const text = (raw ?? "").toLowerCase();
  if (text.includes("only a workspace owner")) {
    return { status: 403, code: "owner_only", message: "Only an owner can do that." };
  }
  if (text.includes("at least one owner")) {
    return {
      status: 409,
      code: "last_owner",
      message: "A Space must always have at least one owner.",
    };
  }
  if (text.includes("membership not found")) {
    return { status: 404, code: "not_found", message: "That member isn't in this Space any more." };
  }
  return { status: 422, code: "could_not_update", message: "Couldn't update that member. Try again." };
}
