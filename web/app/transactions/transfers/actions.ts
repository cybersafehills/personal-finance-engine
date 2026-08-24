"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";

export type SimpleActionResult = { ok: true } | { ok: false; error: string };

/** Confirms a suggested pair as a real self-transfer - excluded from budget aggregation from this point on (see getBudgetActuals). */
export async function confirmTransferLink(
  outTransactionId: string,
  inTransactionId: string,
): Promise<SimpleActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.from("transfer_links").insert({
    workspace_id: workspaceId,
    out_transaction_id: outTransactionId,
    in_transaction_id: inTransactionId,
    status: "linked",
  });

  if (error) {
    return { ok: false, error: "Could not confirm the transfer." };
  }

  revalidatePath("/transactions/transfers");
  revalidatePath("/budgets");
  return { ok: true };
}

/** Dismisses a suggested pair as not actually a transfer - remembered so it doesn't keep reappearing. */
export async function dismissTransferSuggestion(
  outTransactionId: string,
  inTransactionId: string,
): Promise<SimpleActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.from("transfer_links").insert({
    workspace_id: workspaceId,
    out_transaction_id: outTransactionId,
    in_transaction_id: inTransactionId,
    status: "dismissed",
  });

  if (error) {
    return { ok: false, error: "Could not dismiss the suggestion." };
  }

  revalidatePath("/transactions/transfers");
  return { ok: true };
}

/** Undoes a confirmed transfer link, so the two transactions count in budget aggregation again. */
export async function unlinkTransfer(linkId: string): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.from("transfer_links").delete().eq("id", linkId);

  if (error) {
    return { ok: false, error: "Could not undo the transfer link." };
  }

  revalidatePath("/transactions/transfers");
  revalidatePath("/budgets");
  return { ok: true };
}
