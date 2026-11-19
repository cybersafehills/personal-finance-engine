import { completePages } from "../../../../shared/financial";
import { supabase } from "@/api/supabase";

export type ShareMode = "share_transactions" | "share_account";
export type ShareStatus = "active" | "paused" | "revoked";
type OwnedSource = { id: string; display_name: string; currency: string };
type ShareLink = { financial_source_id: string; visibility_mode: ShareMode; status: ShareStatus };
export type HouseholdSource = OwnedSource & { link: ShareLink | undefined };

export async function loadHouseholdSources(userId: string, spaceId: string): Promise<HouseholdSource[]> {
  const client = supabase;
  if (!client) throw new Error("not configured");
  const [sources, links] = await Promise.all([
    completePages<OwnedSource>(async (offset, size) => {
      const { data, error } = await client.from("financial_sources")
        .select("id,display_name,currency")
        .eq("owner_user_id", userId)
        .eq("status", "active")
        .order("id")
        .range(offset, offset + size - 1);
      if (error) throw error;
      return data ?? [];
    }),
    completePages<ShareLink>(async (offset, size) => {
      const { data, error } = await client.from("source_space_links")
        .select("financial_source_id,visibility_mode,status")
        .eq("workspace_id", spaceId)
        .order("financial_source_id")
        .range(offset, offset + size - 1);
      if (error) throw error;
      return data ?? [];
    }),
  ]);
  const bySource = new Map(links.map((link) => [link.financial_source_id, link]));
  return sources.map((source) => ({ ...source, link: bySource.get(source.id) }));
}

export async function updateHouseholdShare(
  spaceId: string,
  sourceId: string,
  action: { mode: "share_account" } | { status: ShareStatus },
): Promise<boolean> {
  if (!supabase) return false;
  const scope = { p_source_id: sourceId, p_workspace_id: spaceId };
  try {
    const { error } = "mode" in action
      ? await supabase.rpc("allocate_source_to_space", {
        ...scope,
        p_visibility_mode: action.mode,
        p_is_default: false,
      })
      : await supabase.rpc("set_source_space_link_status", { ...scope, p_status: action.status });
    return !error;
  } catch {
    return false;
  }
}
