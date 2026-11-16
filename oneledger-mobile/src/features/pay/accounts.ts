import { supabase } from "@/api/supabase";

// The accounts a payment can be made from, with the `provider` the app needs to
// know which network's USSD applies (listManualAccounts doesn't carry it).
// RLS-scoped, like every other read.

export type PayerAccount = {
  id: string;
  name: string;
  workspaceId: string;
  currency: string;
  provider: string | null;
  /**
   * Whose account it is (`financial_sources.owner_user_id`), or null when it
   * can't be told (no source, or a source this user can't see). In a household
   * the accounts of other members are in the same Space.
   */
  ownerUserId: string | null;
};

export async function listPayerAccounts(): Promise<PayerAccount[]> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, currency, workspace_id, provider, financial_sources(owner_user_id)")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error("accounts unavailable");
  return (data ?? []).map((row) => {
    const source = (row as { financial_sources?: { owner_user_id: string } | { owner_user_id: string }[] | null }).financial_sources;
    const owner = Array.isArray(source) ? source[0]?.owner_user_id : source?.owner_user_id;
    return {
      id: row.id as string,
      name: row.name as string,
      workspaceId: row.workspace_id as string,
      currency: row.currency as string,
      provider: (row.provider as string | null) ?? null,
      ownerUserId: owner ?? null,
    };
  });
}
