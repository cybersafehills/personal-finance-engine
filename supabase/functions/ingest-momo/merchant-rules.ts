import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { MerchantClassification, MerchantRuleRow } from "./types.ts";

const EMPTY_CLASSIFICATION: MerchantClassification = {
  normalizedMerchantName: null,
  category: null,
  subcategory: null,
  categorySource: null,
  categoryConfidence: null,
};

export async function applyMerchantRule(
  supabase: SupabaseClient,
  counterpartyName: string | null,
): Promise<MerchantClassification> {
  if (!counterpartyName) {
    return EMPTY_CLASSIFICATION;
  }

  const { data: rules, error } = await supabase
    .from("merchant_rules")
    .select(
      `
        id,
        match_type,
        merchant_pattern,
        normalized_merchant_name,
        category,
        subcategory,
        confidence,
        usage_count
      `,
    )
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error || !rules) {
    console.error("Merchant rule lookup failed:", error);

    return EMPTY_CLASSIFICATION;
  }

  const normalizedCounterparty = counterpartyName.trim().toLowerCase();

  for (const rule of rules as MerchantRuleRow[]) {
    const pattern = String(rule.merchant_pattern).trim().toLowerCase();

    let matched = false;

    switch (rule.match_type) {
      case "exact":
        matched = normalizedCounterparty === pattern;
        break;

      case "contains":
        matched = normalizedCounterparty.includes(pattern);
        break;

      case "starts_with":
        matched = normalizedCounterparty.startsWith(pattern);
        break;

      case "regex":
        try {
          matched = new RegExp(rule.merchant_pattern, "i").test(
            counterpartyName,
          );
        } catch {
          matched = false;
        }
        break;
    }

    if (!matched) {
      continue;
    }

    const currentUsageCount = Number(rule.usage_count ?? 0);

    const { error: ruleUsageUpdateError } = await supabase
      .from("merchant_rules")
      .update({
        usage_count: currentUsageCount + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", rule.id);

    if (ruleUsageUpdateError) {
      console.error(
        "Merchant rule usage update failed:",
        ruleUsageUpdateError,
      );
    }

    return {
      normalizedMerchantName: rule.normalized_merchant_name ??
        counterpartyName,
      category: rule.category ?? null,
      subcategory: rule.subcategory ?? null,
      categorySource: "rule",
      categoryConfidence: Number(rule.confidence) || 1,
    };
  }

  return EMPTY_CLASSIFICATION;
}
