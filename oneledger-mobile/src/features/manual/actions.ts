import { supabase } from "@/api/supabase";
import type { SupportedCurrency } from "@/lib/money";

import type { ManualAccount, ManualTransactionArgs } from "./input";

// Database calls for adding a transaction by hand. Same insert the web's
// "Add transaction" does, as the signed-in user: Row Level Security decides
// what they may write, so no server route is needed.

export class ManualEntryError extends Error {}

const CURRENCIES: readonly SupportedCurrency[] = ["RWF", "EUR", "USD"];

/** Active accounts a manual transaction can belong to (RLS-scoped). */
export async function listManualAccounts(): Promise<ManualAccount[]> {
  if (!supabase) throw new ManualEntryError("This build isn't connected to OneLedger yet.");
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, currency, workspace_id")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new ManualEntryError("Couldn't load your accounts. Try again.");
  return (data ?? [])
    // A currency the app cannot format is left out rather than mislabelled.
    .filter((row) => CURRENCIES.includes(row.currency as SupportedCurrency))
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      workspaceId: row.workspace_id as string,
      currency: row.currency as SupportedCurrency,
    }));
}

/**
 * Creates the transaction through create_manual_transaction and returns its
 * id. Signed-in users cannot INSERT into `transactions` directly (ingestion is
 * the only writer); this function is the one audited path. It checks the
 * caller owns the account's workspace and re-validates every field.
 */
export async function createManualTransaction(args: ManualTransactionArgs): Promise<string> {
  if (!supabase) throw new ManualEntryError("This build isn't connected to OneLedger yet.");
  const { data, error } = await supabase.rpc("create_manual_transaction", args);
  if (error || !data) {
    const message = error?.message ?? "";
    throw new ManualEntryError(
      message.includes("not_found_or_forbidden")
        ? "You can't add transactions to this account."
        : /invalid_(time)/.test(message)
          ? "That time isn't valid. Check the date and time."
          : "Couldn't save that. Check your connection and try again; nothing was added.",
    );
  }
  return data as string;
}
