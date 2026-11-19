import { completePages } from "../../../../web/shared/financial";
import { supabase } from "@/api/supabase";

export type ArchivedWallet = { id: string; name: string; currency: string };

export async function loadArchivedWallets(workspaceId: string): Promise<ArchivedWallet[]> {
  const client = supabase;
  if (!client) throw new Error("not configured");
  return completePages<ArchivedWallet>(async (offset, size) => {
    const { data, error } = await client
      .from("accounts")
      .select("id,name,currency")
      .eq("workspace_id", workspaceId)
      .not("archived_at", "is", null)
      .order("id")
      .range(offset, offset + size - 1);
    if (error) throw error;
    return data ?? [];
  });
}
