import { supabase } from "@/api/supabase";

import { isSpaceKind, type Space } from "./spaces";

/**
 * Every Space the caller is an active member of (the web's
 * `getUserWorkspaces`), oldest membership first. RLS scopes the rows.
 */
export async function getSpaces(): Promise<Space[]> {
  if (!supabase) throw new Error("not configured");
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("role, workspaces(id, name, kind)")
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) => {
    const ws = row.workspaces as unknown as { id: string; name: string; kind: string } | null;
    if (!ws || !isSpaceKind(ws.kind)) return [];
    return [{ id: ws.id, name: ws.name, kind: ws.kind, role: String(row.role) }];
  });
}
