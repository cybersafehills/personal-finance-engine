"use server";

import { revalidatePath } from "next/cache";
import { isOneLedger3FlagEnabled } from "../../lib/oneledger3-flags";
import { getActiveWorkspaceId } from "../../lib/queries";
import { supabaseSession } from "../../lib/supabase-session-server";
import { parseBalanceInput } from "../../lib/wallets/wallets-display";

// "I checked my balance": the user states what their provider shows. The
// database function is the authority - it checks membership (member or
// above), takes the currency from the account, refuses a future time,
// appends a row (never overwrites) and writes an audit event. A typed
// balance is a statement; it is never shown as "Confirmed".

export type RecordBalanceResult = { ok: true } | { ok: false; error: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordBalanceAction(input: {
  accountId: string;
  amountText: string;
  note: string;
}): Promise<RecordBalanceResult> {
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  const workspaceId = await getActiveWorkspaceId();
  if (
    !user || !workspaceId ||
    !isOneLedger3FlagEnabled(process.env, "BALANCE_PROVENANCE", workspaceId)
  ) {
    return { ok: false, error: "Wallet balances aren't available for your account." };
  }
  if (!UUID.test(input.accountId)) {
    return { ok: false, error: "That wallet couldn't be found." };
  }

  // The currency comes from the wallet itself, in the ACTIVE workspace -
  // never from the form.
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("currency")
    .eq("id", input.accountId)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .maybeSingle();
  if (accountError || !account) {
    return { ok: false, error: "That wallet couldn't be found." };
  }

  const parsed = parseBalanceInput(input.amountText, account.currency);
  if (!parsed.ok) return parsed;

  const note = input.note.trim().slice(0, 500);
  const { error } = await supabase.rpc("record_manual_balance_observation", {
    p_account_id: input.accountId,
    p_amount_minor: parsed.amountMinor.toString(),
    p_as_of: new Date().toISOString(),
    p_note: note ? note : null,
  });
  if (error) {
    // Message only - never the amount.
    console.error("recordBalanceAction failed:", error.message);
    return {
      ok: false,
      error: /account_not_found/.test(error.message)
        ? "You don't have permission to enter a balance for this wallet."
        : "Couldn't save your balance. Try again.",
    };
  }

  revalidatePath("/wallets");
  return { ok: true };
}
