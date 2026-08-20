"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "../../lib/supabase-server";

export type CorrectCategoryResult = { ok: true } | { ok: false; error: string };

/**
 * Corrects a single transaction's category/subcategory. Never touches
 * amount_rwf, fee_rwf, direction, status, or any other source financial
 * field - only category, subcategory, and category_source ('manual' is an
 * already-supported value, no schema change). Optionally upserts a
 * merchant_rules row (priority 10, ahead of the default-100 seeded rules)
 * so future transactions from the same counterparty classify correctly -
 * this never rewrites past transactions beyond the one being corrected.
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

  const supabase = supabaseServer();

  const { data: transaction, error: fetchError } = await supabase
    .from("transactions")
    .select("id, counterparty_name")
    .eq("id", transactionId)
    .maybeSingle();

  if (fetchError || !transaction) {
    return { ok: false, error: "Transaction not found." };
  }

  const { error: updateError } = await supabase
    .from("transactions")
    .update({
      category: trimmedCategory,
      subcategory: subcategory?.trim() || null,
      category_source: "manual",
    })
    .eq("id", transactionId);

  if (updateError) {
    return { ok: false, error: "Could not save the category correction." };
  }

  if (saveAsRule && transaction.counterparty_name) {
    const pattern = transaction.counterparty_name.trim();

    const { data: existingRule } = await supabase
      .from("merchant_rules")
      .select("id")
      .eq("match_type", "exact")
      .ilike("merchant_pattern", pattern)
      .maybeSingle();

    if (existingRule) {
      await supabase
        .from("merchant_rules")
        .update({
          category: trimmedCategory,
          subcategory: subcategory?.trim() || null,
          rule_source: "manual",
          confidence: 1,
          priority: 10,
          is_active: true,
        })
        .eq("id", existingRule.id);
    } else {
      await supabase.from("merchant_rules").insert({
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
