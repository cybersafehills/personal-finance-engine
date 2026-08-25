"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";

export type SimpleActionResult = { ok: true } | { ok: false; error: string };

function revalidateReviewRoutes(transactionId: string) {
  revalidatePath("/transactions/review");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/categories");
}

/**
 * Accepts a 'provisional' or 'suggested' transaction's category as-is -
 * for 'suggested' this promotes suggested_category into category for the
 * first time; for 'provisional' the category was already committed, this
 * just marks it reviewed. Either way the result becomes category_source
 * 'manual' / decision_status 'confirmed' - protected from every future
 * automatic overwrite, same as any other manual decision.
 */
export async function confirmTransactionCategory(
  transactionId: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("confirm_transaction_category", {
    p_transaction_id: transactionId,
  });

  if (error) {
    return { ok: false, error: "Could not confirm the category." };
  }

  revalidateReviewRoutes(transactionId);
  return { ok: true };
}

/** Dismisses a pending suggestion or conflict - the transaction goes back to plain Uncategorized, nothing is applied. */
export async function dismissSuggestedCategory(
  transactionId: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("dismiss_suggested_category", {
    p_transaction_id: transactionId,
  });

  if (error) {
    return { ok: false, error: "Could not dismiss the suggestion." };
  }

  revalidateReviewRoutes(transactionId);
  return { ok: true };
}

export type BulkActionResult = { ok: true; succeededCount: number; failedCount: number };

/**
 * Confirms multiple review-queue transactions at once. Loops the same
 * single-row confirm_transaction_category RPC used above rather than a
 * new bulk SQL function - each call is already cheap and
 * membership-checked, and the review queue's realistic scale (a user
 * reviewing their own uncertain transactions) doesn't warrant a
 * set-based bulk RPC the way historical backfill's hundreds-of-rows
 * batches did.
 */
export async function bulkConfirmTransactionCategories(
  transactionIds: string[],
): Promise<BulkActionResult> {
  const supabase = await supabaseSession();
  let succeededCount = 0;
  let failedCount = 0;

  for (const id of transactionIds) {
    const { error } = await supabase.rpc("confirm_transaction_category", { p_transaction_id: id });
    if (error) failedCount += 1;
    else succeededCount += 1;
  }

  revalidatePath("/transactions/review");
  revalidatePath("/transactions");
  revalidatePath("/categories");
  return { ok: true, succeededCount, failedCount };
}

export async function bulkDismissSuggestedCategories(
  transactionIds: string[],
): Promise<BulkActionResult> {
  const supabase = await supabaseSession();
  let succeededCount = 0;
  let failedCount = 0;

  for (const id of transactionIds) {
    const { error } = await supabase.rpc("dismiss_suggested_category", { p_transaction_id: id });
    if (error) failedCount += 1;
    else succeededCount += 1;
  }

  revalidatePath("/transactions/review");
  revalidatePath("/transactions");
  return { ok: true, succeededCount, failedCount };
}
