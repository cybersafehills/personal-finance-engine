import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { NotAuthorizedError } from "./admin";
import { DIRECTORY_PERMISSIONS, type DirectoryPermission } from "./directory-permission-list";

// Application-side mirror of the Phase P `has_directory_permission()`
// SECURITY DEFINER function. The admin RPCs re-check every permission
// inside Postgres regardless, so this is for friendly routing / hiding
// controls the caller can't use - NOT the security boundary.
//
// A platform admin (profiles.is_platform_admin) implies every
// directory.* permission (Platform Owner fallback, ADR 0004).

export { DIRECTORY_PERMISSIONS };
export type { DirectoryPermission };

export type DirectoryAccess = {
  userId: string | null;
  isPlatformAdmin: boolean;
  /** Every directory.* permission the caller effectively holds. */
  permissions: Set<DirectoryPermission>;
  has: (perm: DirectoryPermission) => boolean;
  /** True if the caller may see the admin surface at all. */
  canViewAdmin: boolean;
};

const EMPTY: DirectoryAccess = {
  userId: null,
  isPlatformAdmin: false,
  permissions: new Set(),
  has: () => false,
  canViewAdmin: false,
};

export async function getDirectoryAccess(): Promise<DirectoryAccess> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const [profileRes, grantsRes] = await Promise.all([
    supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle(),
    supabase.from("directory_role_grants").select("permission").eq("user_id", user.id),
  ]);

  const isPlatformAdmin = profileRes.data?.is_platform_admin === true;
  const permissions = new Set<DirectoryPermission>();

  if (isPlatformAdmin) {
    for (const p of DIRECTORY_PERMISSIONS) permissions.add(p);
  } else {
    for (const row of grantsRes.data ?? []) {
      const p = (row as { permission: string }).permission as DirectoryPermission;
      if ((DIRECTORY_PERMISSIONS as readonly string[]).includes(p)) permissions.add(p);
    }
  }

  const has = (perm: DirectoryPermission) => permissions.has(perm);
  // Any directory grant (or being a platform admin) unlocks the read-only
  // admin surface; individual actions are gated per-permission below.
  const canViewAdmin = isPlatformAdmin || permissions.size > 0;

  return { userId: user.id, isPlatformAdmin, permissions, has, canViewAdmin };
}

export async function assertDirectoryAdmin(): Promise<DirectoryAccess> {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) throw new NotAuthorizedError();
  return access;
}

export async function assertDirectoryPermission(
  perm: DirectoryPermission,
): Promise<DirectoryAccess> {
  const access = await getDirectoryAccess();
  if (!access.has(perm)) throw new NotAuthorizedError();
  return access;
}
