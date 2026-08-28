"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../lib/queries";

export type CorrectCategoryResult = { ok: true } | { ok: false; error: string };

/**
 * Corrects a single transaction's category/subcategory. Never touches
 * amount_rwf, fee_rwf, direction, status, or any other source financial
 * field - only category, subcategory, and category_source ('manual' is an
 * already-supported value, no schema change). Optionally upserts a
 * categorization_policies row (priority 10, ahead of the default-100
 * seeded policies) so future transactions from the same counterparty
 * classify correctly - this never rewrites past transactions beyond the
 * one being corrected.
 *
 * The transaction update and its transaction_category_history entry are
 * written atomically via the apply_manual_category_correction() SECURITY
 * DEFINER database function (20260829000000_phase_f_categorization_policies.sql)
 * rather than two separate client calls. That function re-checks workspace
 * membership itself, independent of anything checked here - a caller
 * outside the transaction's workspace gets rejected there. RLS
 * (categorization_policies_write_member / categorization_policies_update_member,
 * see 20260821000000_phase_b_identity_and_tenancy.sql and
 * 20260829000000_phase_f_categorization_policies.sql) still governs the
 * save-as-rule upsert below, which runs as the signed-in user via the
 * session-authenticated client.
 */
export async function correctCategory(
  transactionId: string,
  category: string,
  subcategory: string | null,
  saveAsRule: boolean,
): Promise<CorrectCategoryResult> {
  const trimmedCategory = category.trim();

  if (!trimmedCategory) {
    return { ok: false, error: "Category cannot be empty." };
  }

  const supabase = await supabaseSession();

  const { data: updated, error: rpcError } = await supabase.rpc(
    "apply_manual_category_correction",
    {
      p_transaction_id: transactionId,
      p_category: trimmedCategory,
      p_subcategory: subcategory?.trim() || null,
    },
  );

  if (rpcError || !updated) {
    return { ok: false, error: "Transaction not found." };
  }

  if (saveAsRule && updated.counterparty_name) {
    const pattern = updated.counterparty_name.trim();

    const { data: existingPolicy } = await supabase
      .from("categorization_policies")
      .select("id")
      .eq("match_type", "exact")
      .ilike("merchant_pattern", pattern)
      .maybeSingle();

    if (existingPolicy) {
      await supabase
        .from("categorization_policies")
        .update({
          category: trimmedCategory,
          subcategory: subcategory?.trim() || null,
          rule_source: "manual",
          confidence: 1,
          priority: 10,
          is_active: true,
        })
        .eq("id", existingPolicy.id);
    } else {
      await supabase.from("categorization_policies").insert({
        workspace_id: updated.workspace_id,
        match_type: "exact",
        merchant_pattern: pattern,
        normalized_merchant_name: pattern,
        category: trimmedCategory,
        subcategory: subcategory?.trim() || null,
        rule_source: "manual",
        confidence: 1,
        priority: 10,
        is_active: true,
      });
    }
  }

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/categories");

  return { ok: true };
}

// ===========================================================================
// Space category vocabulary (Phase T PR4). Thin wrappers over the
// capability-gated, audited RPCs in
// supabase/migrations/20260919000000_phase_t_workspace_categories.sql.
// ===========================================================================

export type SpaceCategoryActionResult =
  | { ok: true }
  | { ok: false; error: string };

function slugifyCategoryKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 49);
}

export async function addSpaceCategory(
  label: string,
  parentKey: string | null,
): Promise<SpaceCategoryActionResult> {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: "Give the category a name." };
  const key = slugifyCategoryKey(trimmed);
  if (!key) {
    return { ok: false, error: "Use at least one letter or digit in the name." };
  }

  const supabase = await supabaseSession();
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return { ok: false, error: "Could not resolve your Space." };

  const { error } = await supabase.rpc("upsert_workspace_category", {
    p_workspace_id: workspaceId,
    p_key: key,
    p_label: trimmed,
    p_parent_key: parentKey,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.message.length > 0 && error.message.length < 200
          ? error.message
          : "Could not add the category.",
    };
  }

  revalidatePath("/categories");
  return { ok: true };
}

export async function setSpaceCategoryArchived(
  key: string,
  archived: boolean,
): Promise<SpaceCategoryActionResult> {
  const supabase = await supabaseSession();
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return { ok: false, error: "Could not resolve your Space." };

  const { error } = await supabase.rpc("set_workspace_category_archived", {
    p_workspace_id: workspaceId,
    p_key: key,
    p_archived: archived,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.message.length > 0 && error.message.length < 200
          ? error.message
          : "Could not update the category.",
    };
  }

  revalidatePath("/categories");
  return { ok: true };
}
