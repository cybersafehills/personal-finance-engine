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

// The first time a category is ever mapped there is no prior
// classification to preserve, so the mapping is backdated to cover every
// transaction already recorded under that category - "this category has
// always meant X". Only a later *re-map* (history already exists) is
// effective-dated from the change date, keeping closed periods
// reproducible. aggregateOutflowsByAllocation() in lib/budget-math.ts
// relies on this: it matches on effective_from <= occurred_at and must
// not be "fixed" to ignore dates. Mappings saved before this change with
// today's date were repaired by migration
// 20260906091843_backdate_sole_category_mappings.
const EPOCH_DATE_KEY = "1970-01-01";

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

  // Has this category ever been mapped before (open OR closed row)? If
  // not, this is a first mapping and backdates to the epoch so it covers
  // spend already recorded; otherwise it takes effect from today.
  const { count: priorMappingCount, error: priorError } = await supabase
    .from("budget_category_mappings")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("category", trimmedCategory);

  if (priorError) {
    return { ok: false, error: "Could not check the existing mapping." };
  }

  const effectiveFrom = (priorMappingCount ?? 0) > 0 ? today : EPOCH_DATE_KEY;

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
      effective_from: effectiveFrom,
    });

  if (insertError) {
    return { ok: false, error: "Could not save the mapping." };
  }

  revalidatePath("/budgets/categories");
  revalidatePath("/budgets");
  revalidatePath("/reports");
  revalidatePath("/");
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
  revalidatePath("/reports");
  revalidatePath("/");
  return { ok: true };
}
