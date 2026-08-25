"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../../../lib/supabase-session-server";

export type PreviewSampleRow = {
  id: string;
  counterparty_name: string | null;
  amount_rwf: number;
  direction: string;
  occurred_at: string;
};

export type PreviewResult =
  | { ok: true; matchCount: number; sample: PreviewSampleRow[] }
  | { ok: false; error: string };

export async function previewHistoricalMatches(policyId: string): Promise<PreviewResult> {
  const supabase = await supabaseSession();

  const [{ data: countData, error: countError }, { data: sampleData, error: sampleError }] =
    await Promise.all([
      supabase.rpc("preview_policy_historical_match_count", { p_policy_id: policyId }),
      supabase.rpc("preview_policy_historical_matches", { p_policy_id: policyId, p_limit: 10 }),
    ]);

  if (countError || sampleError) {
    return { ok: false, error: "Could not preview this rule against existing transactions." };
  }

  return {
    ok: true,
    matchCount: Number(countData ?? 0),
    sample: (sampleData ?? []).map((t: PreviewSampleRow) => ({
      id: t.id,
      counterparty_name: t.counterparty_name,
      amount_rwf: t.amount_rwf,
      direction: t.direction,
      occurred_at: t.occurred_at,
    })),
  };
}

export type ApplyBatchResult = { ok: true; appliedCount: number } | { ok: false; error: string };

/** Applies one bounded batch (up to 200 rows) - the client calls this repeatedly, generating one bulkOperationId up front, until it returns appliedCount 0. */
export async function applyHistoricalBatch(
  policyId: string,
  bulkOperationId: string,
): Promise<ApplyBatchResult> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("apply_policy_to_historical", {
    p_policy_id: policyId,
    p_bulk_operation_id: bulkOperationId,
    p_batch_size: 200,
  });

  if (error) {
    return { ok: false, error: "Could not apply the rule to existing transactions." };
  }

  revalidatePath("/transactions");
  revalidatePath("/transactions/review");
  revalidatePath("/categories");
  revalidatePath("/categories/rules");
  return { ok: true, appliedCount: Number(data ?? 0) };
}

export type RevertResult = { ok: true; revertedCount: number } | { ok: false; error: string };

export async function revertBulkCategorization(bulkOperationId: string): Promise<RevertResult> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("revert_bulk_categorization", {
    p_bulk_operation_id: bulkOperationId,
  });

  if (error) {
    return { ok: false, error: "Could not revert this batch." };
  }

  revalidatePath("/transactions");
  revalidatePath("/transactions/review");
  revalidatePath("/categories");
  revalidatePath("/categories/rules");
  return { ok: true, revertedCount: Number(data ?? 0) };
}
