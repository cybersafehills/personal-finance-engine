import { supabase } from "@/api/supabase";

// The user stating their own balance. Runs as the signed-in user under RLS:
// the database function checks they are a member, rejects a future time, writes
// an append-only observation and an audit event. It is a statement, never
// "Confirmed" - only a provider message can confirm a balance.

export type RecordBalanceResult = { ok: true } | { ok: false; message: string };

export async function recordBalance(args: {
  accountId: string;
  amountMinor: bigint;
  note?: string;
}): Promise<RecordBalanceResult> {
  if (!supabase) return { ok: false, message: "The app isn't connected yet." };
  const { error } = await supabase.rpc("record_manual_balance_observation", {
    p_account_id: args.accountId,
    p_amount_minor: args.amountMinor.toString(),
    p_as_of: new Date().toISOString(),
    p_note: args.note?.trim() ? args.note.trim().slice(0, 500) : null,
  });
  if (error) {
    return {
      ok: false,
      message: /account_not_found/.test(error.message)
        ? "That wallet couldn't be found."
        : "Couldn't save your balance. Check your connection and try again.",
    };
  }
  return { ok: true };
}
