import { supabase } from "@/api/supabase";

// Review-queue decisions. These are the same database functions the web's
// server actions call (web/app/transactions/review/actions.ts), run as the
// signed-in user: the database checks workspace membership itself, so the
// app needs no server route and cannot do more than the user already can.
// Both are idempotent enough to retry; a repeat just reports not-found.

/** Thrown when a decision could not be saved. The message is user-safe. */
export class ReviewActionError extends Error {}

async function callRpc(fn: "confirm_transaction_category" | "dismiss_suggested_category", id: string) {
  if (!supabase) throw new ReviewActionError("This build isn't connected to OneLedger yet.");
  const { error } = await supabase.rpc(fn, { p_transaction_id: id });
  if (error) {
    throw new ReviewActionError(
      error.message.includes("not_found_or_forbidden")
        ? "You can't change this transaction."
        : "Couldn't save that. Check your connection and try again.",
    );
  }
}

/** Accept the suggested (or automatic) category as a manual decision. */
export function confirmCategory(transactionId: string): Promise<void> {
  return callRpc("confirm_transaction_category", transactionId);
}

/** Reject the suggestion; the transaction goes back to Uncategorized. */
export function dismissSuggestion(transactionId: string): Promise<void> {
  return callRpc("dismiss_suggested_category", transactionId);
}
