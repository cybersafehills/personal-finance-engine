import { supabase } from "@/api/supabase";

// Review-queue decisions. These are the same database functions the web's
// server actions call (web/app/transactions/review/actions.ts), run as the
// signed-in user: the database checks workspace membership itself, so the
// app needs no server route and cannot do more than the user already can.
// Both are idempotent enough to retry; a repeat just reports not-found.

/** Thrown when a decision could not be saved. The message is user-safe. */
export class ReviewActionError extends Error {}

type RpcName =
  | "confirm_transaction_category"
  | "dismiss_suggested_category"
  | "dismiss_possible_duplicate"
  | "merge_duplicate_transaction";

async function callRpc(fn: RpcName, args: Record<string, string>) {
  if (!supabase) throw new ReviewActionError("This build isn't connected to OneLedger yet.");
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    throw new ReviewActionError(
      error.message.includes("not_found_or_forbidden")
        ? "You can't change this transaction."
        : "Couldn't save that. Check your connection and try again.",
    );
  }
}

/** Accept the suggested (or automatic) category as a manual decision. */
export function confirmCategory(transactionId: string): Promise<void> {
  return callRpc("confirm_transaction_category", { p_transaction_id: transactionId });
}

/** "Not a duplicate": the transaction goes back to a normal, unique one. */
export function dismissDuplicate(transactionId: string): Promise<void> {
  return callRpc("dismiss_possible_duplicate", { p_transaction_id: transactionId });
}

/**
 * Keep `canonicalId`, fold `duplicateId` into it. The duplicate row is kept as
 * evidence but leaves every total and list (the database enforces that both
 * are in the same workspace and that the caller may categorise there).
 */
export function mergeDuplicate(duplicateId: string, canonicalId: string): Promise<void> {
  return callRpc("merge_duplicate_transaction", {
    p_duplicate_id: duplicateId,
    p_canonical_id: canonicalId,
  });
}

/** Reject the suggestion; the transaction goes back to Uncategorized. */
export function dismissSuggestion(transactionId: string): Promise<void> {
  return callRpc("dismiss_suggested_category", { p_transaction_id: transactionId });
}

export type CorrectionResult = {
  /** True/false when a rule was requested; null when it was not. */
  ruleSaved: boolean | null;
};

/**
 * Set a transaction's category (a manual decision, protected from automatic
 * overwrite). Re-picking the category a row already has keeps its
 * subcategory (pass it in); a different category clears it, like the web.
 *
 * Optionally remember it as a rule for the same counterparty, as the web
 * does: an exact-name rule at priority 10, ahead of the seeded defaults,
 * scoped to the transaction's own workspace. Saving the category is the
 * important part; a rule that fails is reported, not fatal.
 */
export async function correctCategory(
  transactionId: string,
  category: string,
  subcategory: string | null,
  saveAsRule: boolean,
): Promise<CorrectionResult> {
  if (!supabase) throw new ReviewActionError("This build isn't connected to OneLedger yet.");
  const name = category.trim();
  if (!name) throw new ReviewActionError("Choose a category first.");
  const sub = subcategory?.trim() || null;

  const { data: updated, error } = await supabase.rpc("apply_manual_category_correction", {
    p_transaction_id: transactionId,
    p_category: name,
    p_subcategory: sub,
  });
  if (error || !updated) {
    throw new ReviewActionError(
      error?.message.includes("not_found_or_forbidden")
        ? "You can't change this transaction."
        : "Couldn't save that. Check your connection and try again.",
    );
  }

  const row = updated as { counterparty_name: string | null; workspace_id: string };
  const counterparty = row.counterparty_name?.trim();
  if (!saveAsRule || !counterparty) return { ruleSaved: null };

  const fields = {
    category: name,
    subcategory: sub,
    rule_source: "manual",
    confidence: 1,
    priority: 10,
    is_active: true,
  };
  // Match in code, not with ilike: PostgREST turns `*` into a wildcard in
  // like patterns, and a workspace has few exact rules, so this is cheap and
  // tolerates two rules that differ only by case.
  const existing = await supabase
    .from("categorization_policies")
    .select("id, merchant_pattern")
    .eq("workspace_id", row.workspace_id)
    .eq("match_type", "exact");
  if (existing.error) return { ruleSaved: false };
  const match = (existing.data ?? []).find(
    (p) => (p.merchant_pattern as string).trim().toLowerCase() === counterparty.toLowerCase(),
  );

  const write = match
    ? await supabase
        .from("categorization_policies")
        .update(fields)
        .eq("id", match.id)
        .eq("workspace_id", row.workspace_id)
    : await supabase.from("categorization_policies").insert({
        ...fields,
        workspace_id: row.workspace_id,
        match_type: "exact",
        merchant_pattern: counterparty,
        normalized_merchant_name: counterparty,
      });
  return { ruleSaved: !write.error };
}
