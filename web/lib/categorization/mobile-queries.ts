import "server-only";
import { supabaseSession } from "../supabase-session-server";
import type { RuleRow } from "../mobile-rules";

const COLUMNS =
  "id, name, category, subcategory, match_type, merchant_pattern, direction, amount_min_rwf, amount_max_rwf, time_start, time_end, days_of_week, days_of_month, transaction_types, fee_min_rwf, fee_max_rwf, amount_round_multiple, priority, is_active, rule_source, usage_count, scope_type";

// A strict read for the mobile route: unlike the web's getCategorizationPolicies
// (which turns a failure into []), this THROWS, so a failed read is a retryable
// error and never an empty list that reads as "no rules". Scoped to one Space
// explicitly, as the web's own read is.
export async function getMobileRules(workspaceId: string): Promise<RuleRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("categorization_policies")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`rules read failed: ${error.message}`);
  return (data ?? []) as RuleRow[];
}
