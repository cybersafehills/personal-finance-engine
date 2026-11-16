import { supabase } from "@/api/supabase";

import { asRole, type Member, type PendingInvite } from "./members";

// Reads for Space & members. Plain RLS reads, the same rows the web's page
// shows; writes go through /api/mobile/spaces/* (second factor required).

export async function getMembers(workspaceId: string): Promise<Member[]> {
  if (!supabase) throw new Error("not configured");
  const [{ data, error }, { data: userData }] = await Promise.all([
    supabase
      .from("workspace_memberships")
      .select("id, user_id, role, status, joined_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "removed")
      .order("role", { ascending: true })
      .order("joined_at", { ascending: true }),
    supabase.auth.getUser(),
  ]);
  if (error) throw new Error(error.message);
  const me = userData.user?.id;
  return (data ?? []).map((row) => ({
    membershipId: row.id as string,
    userId: row.user_id as string,
    role: asRole(row.role),
    status: String(row.status),
    joinedAt: (row.joined_at as string | null) ?? null,
    isSelf: row.user_id === me,
  }));
}

/** Display names (any member may read them). Best effort: a failure just means "Member 1a2b3c4d". */
export async function getMemberNames(workspaceId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!supabase) return names;
  const { data, error } = await supabase.rpc("space_member_directory", { p_workspace_id: workspaceId });
  if (error || !Array.isArray(data)) return names;
  for (const row of data as { user_id: string; display_name: string | null }[]) {
    if (row.display_name) names.set(row.user_id, row.display_name);
  }
  return names;
}

/** Pending invites. RLS returns none unless the caller manages the Space. */
export async function getPendingInvites(workspaceId: string): Promise<PendingInvite[]> {
  if (!supabase) throw new Error("not configured");
  const { data, error } = await supabase
    .from("workspace_invites")
    .select("id, email, role, expires_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    role: asRole(row.role),
    expiresAt: row.expires_at as string,
    expired: new Date(row.expires_at as string).getTime() < now,
  }));
}
