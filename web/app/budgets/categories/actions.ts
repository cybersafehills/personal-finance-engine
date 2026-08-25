"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { ALLOCATION_TYPES, AllocationType } from "../../../lib/budget-math";

export type SimpleActionResult = { ok: true } | { ok: false; error: string };

function isAllocationType(value: string): value is AllocationType {
  return (ALLOCATION_TYPES as readonly string[]).includes(value);
}

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sets (or changes) a category's mapping to an allocation type.
 * Effective-dated, never overwritten in place: any existing open-ended
 * mapping row for this category is closed (effective_until = today) and
 * a new open row is inserted starting today - a remap never rewrites how
 * a transaction that already occurred was classified at the time (see
 * budget_category_mappings' own comments in the Phase D migration).
 */
export async function setCategoryMapping(
  category: string,
  allocationType: string,
): Promise<SimpleActionResult> {
  const trimmedCategory = category.trim();
  if (!trimmedCategory) {
    return { ok: false, error: "Category cannot be empty." };
  }
  if (!isAllocationType(allocationType)) {
    return { ok: false, error: "Unrecognized allocation type." };
  }

  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const today = todayDateKey();

  const { data: existing, error: existingError } = await supabase
    .from("budget_category_mappings")
    .select("id, allocation_type")
    .eq("workspace_id", workspaceId)
    .eq("category", trimmedCategory)
    .is("effective_until", null)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: "Could not check the existing mapping." };
  }

  if (existing && existing.allocation_type === allocationType) {
    return { ok: true };
  }

  if (existing) {
    const { error: closeError } = await supabase
      .from("budget_category_mappings")
      .update({ effective_until: today })
      .eq("id", existing.id);
    if (closeError) {
      return { ok: false, error: "Could not close the previous mapping." };
    }
  }

  const { error: insertError } = await supabase
    .from("budget_category_mappings")
    .insert({
      workspace_id: workspaceId,
      category: trimmedCategory,
      allocation_type: allocationType,
      effective_from: today,
    });

  if (insertError) {
    return { ok: false, error: "Could not save the mapping." };
  }

  revalidatePath("/budgets/categories");
  revalidatePath("/budgets");
  return { ok: true };
}

/** Removes a category's current mapping (closes the open row, inserts nothing new). */
export async function removeCategoryMapping(
  category: string,
): Promise<SimpleActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("budget_category_mappings")
    .update({ effective_until: todayDateKey() })
    .eq("workspace_id", workspaceId)
    .eq("category", category.trim())
    .is("effective_until", null);

  if (error) {
    return { ok: false, error: "Could not remove the mapping." };
  }

  revalidatePath("/budgets/categories");
  revalidatePath("/budgets");
  return { ok: true };
}
