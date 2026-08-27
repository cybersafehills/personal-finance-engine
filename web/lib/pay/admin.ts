import "server-only";
import { supabaseSession } from "../supabase-session-server";

// Platform-admin check for the Pay & Services admin surface. Reads
// profiles.is_platform_admin for the signed-in user through the
// RLS-scoped client (a user can always read their own profile row). This
// is the *application* mirror of the database's is_platform_admin()
// SECURITY DEFINER function - the RPCs re-check server-side regardless,
// so this is for friendly routing/UX, not the security boundary.

export class NotAuthorizedError extends Error {
  constructor() {
    super("not_authorized");
    this.name = "NotAuthorizedError";
  }
}

export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return false;
  return data.is_platform_admin === true;
}

export async function assertPlatformAdmin(): Promise<void> {
  if (!(await isPlatformAdmin())) {
    throw new NotAuthorizedError();
  }
}
