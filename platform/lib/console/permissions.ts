// Role / permission vocabulary. The authoritative role->permission matrix lives
// in the database (console_role_permissions) and is delivered to the app by
// console_my_access(); this file holds only labels and the pure `can` helper.
// UI gating here is UX - every RPC re-checks server-side.

export const ROLES = [
  "platform_owner",
  "platform_admin",
  "finance_admin",
  "security_admin",
  "support_agent",
  "read_only_analyst",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  platform_owner: "Platform Owner",
  platform_admin: "Platform Administrator",
  finance_admin: "Finance Administrator",
  security_admin: "Security Administrator",
  support_agent: "Customer Support Agent",
  read_only_analyst: "Read-Only Analyst",
};

export type Access = {
  role: Role;
  permissions: readonly string[];
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(access: Access | null | undefined, permission: string): boolean {
  return !!access && access.permissions.includes(permission);
}

// Shape returned by console_my_access().
export type MyAccessResult =
  | { signed_in: false }
  | { signed_in: true; is_staff: false }
  | { signed_in: true; is_staff: true; mfa_ok: false }
  | {
      signed_in: true;
      is_staff: true;
      mfa_ok: true;
      role: Role;
      permissions: string[];
    };

export type AccessState =
  | { kind: "signed_out" }
  | { kind: "not_staff" }
  | { kind: "mfa_required" }
  | { kind: "ok"; access: Access };

export function interpretMyAccess(raw: unknown): AccessState {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.signed_in !== true) return { kind: "signed_out" };
  if (r.is_staff !== true) return { kind: "not_staff" };
  if (r.mfa_ok !== true) return { kind: "mfa_required" };
  if (!isRole(r.role) || !Array.isArray(r.permissions)) {
    // Unknown role from the DB: fail closed.
    return { kind: "not_staff" };
  }
  return {
    kind: "ok",
    access: {
      role: r.role,
      permissions: r.permissions.filter((p): p is string => typeof p === "string"),
    },
  };
}
