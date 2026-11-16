import { assertEquals } from "jsr:@std/assert@1";
import {
  mapMemberRpcError,
  parseCreateInvite,
  parseRemove,
  parseRevokeInvite,
  parseSetRole,
} from "./mobile-spaces.ts";

const W = "AAAAAAAA-1111-4222-8333-444444444444";
const M = "bbbbbbbb-1111-4222-8333-444444444444";

Deno.test("parseSetRole needs both ids and a real role, and lower-cases the ids", () => {
  const ok = parseSetRole({ workspaceId: W, membershipId: M, role: "admin" });
  assertEquals(ok, { ok: true, value: { workspaceId: W.toLowerCase(), membershipId: M, role: "admin" } });
  assertEquals(parseSetRole({ workspaceId: W, membershipId: M, role: "root" }).ok, false);
  assertEquals(parseSetRole({ membershipId: M, role: "admin" }).ok, false);
  assertEquals(parseSetRole({ workspaceId: "personal", membershipId: M, role: "admin" }).ok, false);
  assertEquals(parseSetRole(null).ok, false);
  assertEquals(parseSetRole([]).ok, false);
});

Deno.test("parseRemove and parseRevokeInvite require explicit ids", () => {
  assertEquals(parseRemove({ workspaceId: W, membershipId: M }).ok, true);
  assertEquals(parseRemove({ membershipId: M }).ok, false);
  assertEquals(parseRevokeInvite({ workspaceId: W, inviteId: M }).ok, true);
  assertEquals(parseRevokeInvite({ workspaceId: W }).ok, false);
});

Deno.test("parseCreateInvite validates the email and refuses to invite an owner", () => {
  const ok = parseCreateInvite({ workspaceId: W, email: "  a@b.co ", role: "viewer" });
  assertEquals(ok.ok && ok.value.email, "a@b.co");
  assertEquals(parseCreateInvite({ workspaceId: W, email: "a@b.co", role: "owner" }).ok, false);
  assertEquals(parseCreateInvite({ workspaceId: W, email: "", role: "member" }), {
    ok: false,
    message: "Enter an email address.",
  });
  for (const bad of ["nope", "a@b", "a b@c.co", "a@b.co, c@d.co", 'a"@b.co', "x".repeat(260) + "@b.co"]) {
    assertEquals(parseCreateInvite({ workspaceId: W, email: bad, role: "member" }).ok, false);
  }
  assertEquals(parseCreateInvite({ email: "a@b.co", role: "member" }).ok, false);
});

Deno.test("database errors become fixed sentences, never raw text", () => {
  assertEquals(mapMemberRpcError("Only a workspace owner can change member roles.").code, "owner_only");
  assertEquals(mapMemberRpcError("Only a workspace owner can remove a member.").status, 403);
  assertEquals(mapMemberRpcError("A workspace must always have at least one owner.").status, 409);
  assertEquals(mapMemberRpcError("Membership not found.").status, 404);
  const other = mapMemberRpcError("relation \"secret\" does not exist");
  assertEquals(other.status, 422);
  assertEquals(other.message.includes("secret"), false);
  assertEquals(mapMemberRpcError(null).code, "could_not_update");
});
