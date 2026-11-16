import "server-only";

import { MobileApiError } from "./mobile-request";
import type { supabaseSession } from "./supabase-session-server";

type Supabase = Awaited<ReturnType<typeof supabaseSession>>;

export type SpaceAccess = { kind: "personal" | "household" | "organization"; role: string };

/**
 * The caller's own standing in the Space a write names. These routes take the
 * Space explicitly and never fall back to the personal one (a write that
 * landed in the wrong Space would be silent), so a Space the caller is not an
 * active member of is a plain 404, indistinguishable from one that does not
 * exist. RLS already limits the rows to the caller's own memberships.
 */
export async function requireSpaceAccess(
  supabase: Supabase,
  workspaceId: string,
  userId: string,
): Promise<SpaceAccess> {
  const { data } = await supabase
    .from("workspace_memberships")
    .select("role, workspaces(kind)")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const row = data as unknown as { role: string; workspaces: { kind: SpaceAccess["kind"] } | null } | null;
  if (!row || !row.workspaces) {
    throw new MobileApiError(404, "not_found", "That Space isn't available.");
  }
  return { kind: row.workspaces.kind, role: row.role };
}
