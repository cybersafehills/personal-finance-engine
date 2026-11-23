import { selectedWorkspaceId } from "@/features/spaces/selected-space";
import { assertCachedAccess } from "@/offline/visibility";
import { supabase } from "@/api/supabase";
import { readableDb } from "@/offline/runtime";
import { QueryError } from "@/features/transactions/queries";

import { mergeCategoryOptions } from "./options";

/**
 * Category suggestions: the workspace's own category list plus names already
 * used on recent transactions. Like every read here it runs as the user, so
 * Row Level Security decides what is visible.
 */
export async function getCategoryOptions(): Promise<string[]> {
  // With a device copy: categories already used (works offline) plus the workspace's
  // own list when the server can be reached.
  const workspaceId = selectedWorkspaceId();
  const local = readableDb();
  if (local) {
    await assertCachedAccess(local, workspaceId);
    const used = await local.all<{ category: string }>(
      "SELECT category FROM transactions WHERE workspace_id = ? AND visibility_revoked = 0 AND category IS NOT NULL AND dedupe_state <> 'merged' ORDER BY occurred_at DESC LIMIT 500", [workspaceId],
    );
    let vocab: string[] = [];
    if (supabase) {
      try {
        const res = await supabase.from("workspace_categories").select("label").eq("workspace_id", workspaceId).eq("is_archived", false);
        if (!res.error) vocab = (res.data ?? []).map((r) => r.label as string);
      } catch {
        // Offline: the used-categories list is enough.
      }
    }
    return mergeCategoryOptions(vocab, used.map((r) => r.category));
  }
  if (!supabase) throw new QueryError("This build isn't connected to OneLedger yet.");
  const [vocab, used] = await Promise.all([
    supabase.from("workspace_categories").select("label").eq("workspace_id", workspaceId).eq("is_archived", false),
    supabase
      .from("transactions")
      .select("category")
      .eq("workspace_id", workspaceId)
      .neq("dedupe_state", "merged")
      .not("category", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(500),
  ]);
  if (vocab.error) throw new QueryError(vocab.error.message);
  if (used.error) throw new QueryError(used.error.message);
  return mergeCategoryOptions(
    (vocab.data ?? []).map((r) => r.label as string),
    (used.data ?? []).map((r) => r.category as string | null),
  );
}
