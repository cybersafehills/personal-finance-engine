import { supabase } from "@/api/supabase";
import { QueryError } from "@/features/transactions/queries";

import { mergeCategoryOptions } from "./options";

/**
 * Category suggestions: the workspace's own category list plus names already
 * used on recent transactions. Like every read here it runs as the user, so
 * Row Level Security decides what is visible.
 */
export async function getCategoryOptions(): Promise<string[]> {
  if (!supabase) throw new QueryError("This build isn't connected to OneLedger yet.");
  const [vocab, used] = await Promise.all([
    supabase.from("workspace_categories").select("label").eq("is_archived", false),
    supabase
      .from("transactions")
      .select("category")
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
