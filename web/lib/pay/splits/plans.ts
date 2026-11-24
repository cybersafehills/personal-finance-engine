import "server-only";

import { supabaseSession } from "../../supabase-session-server";

// Reading a split plan and its parts. Plans and part intents are both
// RLS-scoped to the caller's workspaces; nothing here writes.

export type SplitPlanRow = {
  id: string;
  workspace_id: string;
  kind: "capacity" | "fee_saving";
  network_slug: string | null;
  payment_type: string;
  currency: string;
  total_amount_minor: number | string;
  planned_parts: (string | number)[];
  single_fee_minor: number | string | null;
  planned_fee_minor: number | string | null;
  fee_basis: "none" | "published_maximum" | "verified_tariff";
  threshold: string | null;
  stopped_at: string | null;
  created_at: string;
};

export type SplitPartRow = {
  id: string;
  split_index: number;
  amount_minor: number | string;
  currency: string;
  state: string;
  verified_at: string | null;
  manually_confirmed_at: string | null;
  fee_minor: number | string | null;
  recipient_name: string | null;
  recipient_msisdn_masked: string | null;
  recipient_msisdn_normalized: string | null;
  merchant_code: string | null;
  provider: string | null;
  source_account_id: string | null;
  payment_type: string;
  note: string | null;
  category: string | null;
  budget_id: string | null;
  trusted_recipient_id: string | null;
};

const PLAN_COLUMNS =
  "id, workspace_id, kind, network_slug, payment_type, currency, total_amount_minor, planned_parts, single_fee_minor, planned_fee_minor, fee_basis, threshold, stopped_at, created_at";
const PART_COLUMNS =
  "id, split_index, amount_minor, currency, state, verified_at, manually_confirmed_at, fee_minor, recipient_name, recipient_msisdn_masked, recipient_msisdn_normalized, merchant_code, provider, source_account_id, payment_type, note, category, budget_id, trusted_recipient_id";

export async function getSplitPlan(
  planId: string,
): Promise<{ plan: SplitPlanRow; parts: SplitPartRow[] } | null> {
  const supabase = await supabaseSession();
  const { data: plan, error } = await supabase
    .from("payment_split_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error("split plan query failed");
  if (!plan) return null;

  const { data: parts, error: pErr } = await supabase
    .from("payment_intents")
    .select(PART_COLUMNS)
    .eq("split_plan_id", planId)
    .order("split_index", { ascending: true });
  if (pErr) throw new Error("split parts query failed");

  return {
    plan: plan as unknown as SplitPlanRow,
    parts: (parts ?? []) as unknown as SplitPartRow[],
  };
}

export { isPartSettled, nextPartStatus } from "./plan-state";
