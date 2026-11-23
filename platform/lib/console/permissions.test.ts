import assert from "node:assert/strict";
import test from "node:test";
import { can, interpretMyAccess } from "./permissions.ts";

test("interpretMyAccess fails closed on every non-ok shape", () => {
  assert.equal(interpretMyAccess(null).kind, "signed_out");
  assert.equal(interpretMyAccess({ signed_in: false }).kind, "signed_out");
  assert.equal(interpretMyAccess({ signed_in: true, is_staff: false }).kind, "not_staff");
  assert.equal(
    interpretMyAccess({ signed_in: true, is_staff: true, mfa_ok: false }).kind,
    "mfa_required",
  );
  // staff + mfa but an unrecognised role -> denied, never elevated
  assert.equal(
    interpretMyAccess({
      signed_in: true,
      is_staff: true,
      mfa_ok: true,
      role: "superuser",
      permissions: ["everything"],
    }).kind,
    "not_staff",
  );
});

test("interpretMyAccess returns role + permissions when fully verified", () => {
  const s = interpretMyAccess({
    signed_in: true,
    is_staff: true,
    mfa_ok: true,
    role: "security_admin",
    permissions: ["view_audit_logs", 7, "view_staff"],
  });
  assert.equal(s.kind, "ok");
  if (s.kind === "ok") {
    assert.deepEqual(s.access.permissions, ["view_audit_logs", "view_staff"]);
    assert.equal(can(s.access, "view_audit_logs"), true);
    assert.equal(can(s.access, "approve_refunds"), false);
  }
});

test("can() is false without access", () => {
  assert.equal(can(null, "view_audit_logs"), false);
  assert.equal(can(undefined, "view_audit_logs"), false);
});
