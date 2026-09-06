import "server-only";

import { supabaseSession } from "./supabase-session-server";

// Self-serve "give me all my data" export (master prompt §94, audit F12).
// A read-only bundle of the data the signed-in user owns or authored,
// assembled through the ordinary RLS-scoped session client - it can only
// ever return rows the caller was already allowed to see. Never
// plan-gated (assessment §7).
//
// Transactions are capped: an export is a convenience, not a bulk data
// pipeline (that is what /integrations/exports is for). The cap is
// recorded in the bundle so a truncated export is never silently partial.

const TRANSACTION_CAP = 10_000;

export type AccountDataExport = {
  exportedAt: string;
  schemaVersion: 1;
  profile: Record<string, unknown> | null;
  workspaces: unknown[];
  financialSources: unknown[];
  accounts: unknown[];
  transactions: unknown[];
  transactionsTruncatedAt: number | null;
  categorizationRules: unknown[];
  budgets: unknown[];
  goals: unknown[];
};

export async function assembleAccountDataExport(): Promise<
  AccountDataExport | null
> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [
    profile,
    memberships,
    sources,
    accounts,
    transactions,
    rules,
    budgets,
    goals,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_memberships")
      .select("workspace_id, role, status, joined_at, workspaces(name, kind)")
      .eq("user_id", user.id),
    supabase
      .from("financial_sources")
      .select("*")
      .eq("owner_user_id", user.id),
    supabase.from("accounts").select("*"),
    supabase
      .from("transactions")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(TRANSACTION_CAP),
    supabase.from("categorization_policies").select("*"),
    supabase.from("budgets").select("*"),
    supabase.from("financial_goals").select("*"),
  ]);

  const txnRows = transactions.data ?? [];

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    profile: (profile.data as Record<string, unknown> | null) ?? null,
    workspaces: memberships.data ?? [],
    financialSources: sources.data ?? [],
    accounts: accounts.data ?? [],
    transactions: txnRows,
    transactionsTruncatedAt: txnRows.length === TRANSACTION_CAP
      ? TRANSACTION_CAP
      : null,
    categorizationRules: rules.data ?? [],
    budgets: budgets.data ?? [],
    goals: goals.data ?? [],
  };
}
