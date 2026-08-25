"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../../lib/queries";

export type SimpleActionResult = { ok: true } | { ok: false; error: string };

/**
 * Accepts a learned suggestion: creates an ordinary categorization_policies
 * row (exact counterparty match, full confidence - it's derived from
 * confirmed human corrections) via the same shape upsertPolicy writes, then
 * records the decision so this suggestion never reappears. The new policy
 * only affects future transactions; applying it to existing Uncategorized
 * ones is the same /categories/rules/[id]/apply flow every other policy
 * already uses - no separate mechanism here.
 */
export async function acceptLearnedSuggestion(
  suggestionKey: string,
  counterpartyName: string,
  category: string,
  subcategory: string | null,
): Promise<SimpleActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();

  const { error: policyError } = await supabase.from("categorization_policies").insert({
    workspace_id: workspaceId,
    name: counterpartyName,
    match_type: "exact",
    merchant_pattern: counterpartyName,
    normalized_merchant_name: counterpartyName,
    category,
    subcategory,
    rule_source: "learned",
    confidence: 1,
    priority: 100,
    is_active: true,
  });

  if (policyError) {
    return { ok: false, error: "Could not create the policy." };
  }

  const { error: decisionError } = await supabase
    .from("learned_policy_suggestion_decisions")
    .insert({ workspace_id: workspaceId, suggestion_key: suggestionKey, status: "accepted" });

  if (decisionError) {
    return { ok: false, error: "Policy created, but could not record the decision." };
  }

  revalidatePath("/categories/rules");
  revalidatePath("/categories/rules/suggestions");
  return { ok: true };
}

export async function dismissLearnedSuggestion(suggestionKey: string): Promise<SimpleActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("learned_policy_suggestion_decisions")
    .insert({ workspace_id: workspaceId, suggestion_key: suggestionKey, status: "dismissed" });

  if (error) {
    return { ok: false, error: "Could not dismiss the suggestion." };
  }

  revalidatePath("/categories/rules/suggestions");
  return { ok: true };
}
