import "server-only";
import { supabaseSession } from "./supabase-session-server";
import { getActiveWorkspaceId } from "./queries";
import { isOneLedger3FlagEnabled, type OneLedger3Flag } from "./oneledger3-flags";
import { MobileApiError } from "./mobile-request";

/**
 * The workspace a mobile request acts on, and the signed-in user. A cookie-less
 * request defaults to the user's personal workspace (same as /inbox and
 * /budgets); `requested` may name another workspace ONLY if the caller is an
 * active member of it - checked here (RLS would also hide it). A workspace the
 * caller isn't in is reported as not_found, never as forbidden, so ids can't
 * be probed.
 */
export async function resolveMobileWorkspace(
  requested: string | null,
): Promise<{ userId: string; workspaceId: string }> {
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new MobileApiError(404, "not_found"); // unreachable: the guard already validated the token

  if (requested) {
    const { data } = await supabase
      .from("workspace_memberships")
      .select("workspace_id")
      .eq("workspace_id", requested)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!data) throw new MobileApiError(404, "not_found");
    return { userId: user.id, workspaceId: data.workspace_id };
  }
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) throw new MobileApiError(404, "not_found");
  return { userId: user.id, workspaceId };
}

/** 404 (indistinguishable from "no such route") unless the flag covers this workspace. */
export function requireFlag(flag: OneLedger3Flag, workspaceId: string): void {
  if (!isOneLedger3FlagEnabled(process.env, flag, workspaceId)) {
    throw new MobileApiError(404, "not_found");
  }
}
