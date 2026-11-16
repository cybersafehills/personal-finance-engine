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
};

export async function listPayerAccounts(): Promise<PayerAccount[]> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, currency, workspace_id, provider")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error("accounts unavailable");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    workspaceId: row.workspace_id as string,
    currency: row.currency as string,
    provider: (row.provider as string | null) ?? null,
  }));
}
