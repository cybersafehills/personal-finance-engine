"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";

export type AttributionActionResult = { ok: true } | { ok: false; error: string };

const ATTRIBUTION_TYPES = [
  "shared",
  "member",
  "split",
  "unassigned",
] as const;

function isAttributionType(v: string): v is (typeof ATTRIBUTION_TYPES)[number] {
  return (ATTRIBUTION_TYPES as readonly string[]).includes(v);
}

function friendlyError(message: string | undefined): string {
  if (!message) return "Something went wrong. Try again.";
  return message.length > 200 ? "Something went wrong. Try again." : message;
}

/**
 * Sets who a household transaction's spending belongs to. Thin wrapper
 * over set_transaction_attribution
 * (supabase/migrations/20260913000000_phase_s_shared_ledger_rpcs.sql) -
 * that RPC enforces household-only, the transaction.categorize capability,
 * source visibility, and that every named member is active. `splits` is a
 * list of { userId, shareBps } that must total 10000 for type 'split'.
 */
export async function setTransactionAttribution(
  transactionId: string,
  type: string,
  attributedUserId: string | null,
  splits: Array<{ userId: string; shareBps: number }>,
): Promise<AttributionActionResult> {
  if (!isAttributionType(type)) {
    return { ok: false, error: "Unrecognized attribution." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("set_transaction_attribution", {
    p_transaction_id: transactionId,
    p_attribution_type: type,
    p_attributed_user_id: type === "member" ? attributedUserId : null,
    p_splits:
      type === "split"
        ? splits.map((s) => ({ user_id: s.userId, share_bps: s.shareBps }))
        : null,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions/review");
  return { ok: true };
}
