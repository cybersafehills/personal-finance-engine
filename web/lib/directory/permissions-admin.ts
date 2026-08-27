import "server-only";
import { supabaseServer } from "../supabase-server";
import { assertPlatformAdmin } from "../pay/admin";
import { DIRECTORY_PERMISSIONS, type DirectoryPermission } from "../pay/directory-perms";

// Grant-management reads for /admin/directory/permissions. Joining
// directory_role_grants to a user's email needs auth.users, which is only
// reachable with the service-role client - so this whole surface is
// platform-admin only (the grant/revoke RPCs are is_platform_admin-gated
// in Postgres too).

export type GranteeSummary = {
  userId: string;
  email: string | null;
  permissions: DirectoryPermission[];
};

export async function getDirectoryGrantees(): Promise<GranteeSummary[]> {
  await assertPlatformAdmin();
  const db = supabaseServer();

  const { data: grants } = await db
    .from("directory_role_grants")
    .select("user_id, permission")
    .order("granted_at", { ascending: true });

  const byUser = new Map<string, Set<DirectoryPermission>>();
  for (const g of (grants ?? []) as { user_id: string; permission: string }[]) {
    const set = byUser.get(g.user_id) ?? new Set<DirectoryPermission>();
    if ((DIRECTORY_PERMISSIONS as readonly string[]).includes(g.permission)) {
      set.add(g.permission as DirectoryPermission);
    }
    byUser.set(g.user_id, set);
  }

  const out: GranteeSummary[] = [];
  for (const [userId, perms] of byUser) {
    let email: string | null = null;
    const { data } = await db.auth.admin.getUserById(userId);
    email = data.user?.email ?? null;
    out.push({ userId, email, permissions: [...perms].sort() });
  }
  return out.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  await assertPlatformAdmin();
  const db = supabaseServer();
  // listUsers is paginated; the local operator set is tiny, so one page
  // is plenty. If this ever needs to scale, switch to an admin search.
  const { data } = await db.auth.admin.listUsers({ perPage: 200 });
  const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}
