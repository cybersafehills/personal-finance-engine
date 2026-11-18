import "server-only";
import {
  type BalanceBaselineRow,
  deriveBalance,
  type DerivedBalance,
} from "../balance-status";
import type { supabaseSession } from "../supabase-session-server";

// One loader for every surface that shows wallet balances: the web Wallets
// page and GET /api/mobile/accounts both call this, so a balance label can
// never differ between web and the app. Reads through the SESSION client:
// RLS on accounts / transactions / balance_observations (the view is
// security_invoker) is the authorization boundary; the workspace filter only
// narrows to the active workspace.

type Session = Awaited<ReturnType<typeof supabaseSession>>;

export type WalletRow = {
  id: string;
  name: string;
  provider: string;
  currency: string;
  isPrimary: boolean;
  financialSourceId: string | null;
  latestTxnAt: string | null;
  balance: DerivedBalance;
};

type AccountRow = {
  id: string;
  name: string;
  provider: string;
  currency: string;
  is_primary: boolean;
  financial_source_id: string | null;
};
type BaselineRow = BalanceBaselineRow & {
  account_id: string;
  latest_txn_at: string | null;
};

const NO_BASELINE: BalanceBaselineRow = {
  baseline_amount_minor: null,
  baseline_as_of: null,
  baseline_source: null,
  txns_since_count: 0,
  net_effect_since_minor: 0,
  unresolved_since_count: 0,
  mismatch_since_count: 0,
};

/** Throws on a query error - a wallet list is never shown half-loaded. */
export async function loadWallets(
  supabase: Session,
  workspaceId: string,
  now: Date = new Date(),
): Promise<WalletRow[]> {
  const [accounts, baselines] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, provider, currency, is_primary, financial_source_id")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("is_primary", { ascending: false })
      .order("name"),
    supabase
      .from("account_balance_baselines_v")
      .select("*")
      .eq("workspace_id", workspaceId),
  ]);
  if (accounts.error || baselines.error) {
    throw new Error("accounts query failed");
  }

  const byAccount = new Map(
    ((baselines.data ?? []) as BaselineRow[]).map((b) => [b.account_id, b]),
  );
  return ((accounts.data ?? []) as AccountRow[]).map((a) => {
    const b = byAccount.get(a.id);
    return {
      id: a.id,
      name: a.name,
      provider: a.provider,
      currency: a.currency,
      isPrimary: a.is_primary,
      financialSourceId: a.financial_source_id,
      latestTxnAt: b?.latest_txn_at ?? null,
      balance: deriveBalance(b ?? NO_BASELINE, now),
    };
  });
}

export type EnteredBalance = {
  id: string;
  accountId: string;
  amountMinor: bigint;
  currency: string;
  asOf: string;
  note: string | null;
};

/** The most recent balances people in this Space typed in (append-only log). */
export async function loadEnteredBalances(
  supabase: Session,
  workspaceId: string,
  limit = 50,
): Promise<EnteredBalance[]> {
  const { data, error } = await supabase
    .from("balance_observations")
    .select("id, account_id, amount_minor, currency, as_of, note")
    .eq("workspace_id", workspaceId)
    .order("as_of", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("balance observations query failed");
  return (data ?? []).map((o) => ({
    id: o.id as string,
    accountId: o.account_id as string,
    amountMinor: BigInt(o.amount_minor as number | string),
    currency: o.currency as string,
    asOf: o.as_of as string,
    note: (o.note as string | null) ?? null,
  }));
}

export type WalletSpaces = {
  activeName: string | null;
  /** Other Spaces the caller belongs to that DO have wallets, most first. */
  others: { id: string; name: string; count: number }[];
};

/**
 * Which Spaces hold wallets. Wallets are per Space, but you can belong to
 * several (Personal, a household, ...). When the active Space has none, this
 * says where they are so the page can offer a switch instead of a dead end.
 * Reads through RLS (every Space the caller is a member of).
 */
export async function loadWalletSpaces(
  supabase: Session,
  activeWorkspaceId: string,
): Promise<WalletSpaces> {
  const [accounts, active] = await Promise.all([
    supabase
      .from("accounts")
      .select("workspace_id, workspaces(name)")
      .is("archived_at", null),
    supabase.from("workspaces").select("name").eq("id", activeWorkspaceId)
      .maybeSingle(),
  ]);
  const activeName = typeof active.data?.name === "string"
    ? active.data.name
    : null;
  if (accounts.error) return { activeName, others: [] };

  const counts = new Map<string, { name: string; count: number }>();
  for (
    const row of (accounts.data ?? []) as unknown as {
      workspace_id: string;
      workspaces: { name: string } | { name: string }[] | null;
    }[]
  ) {
    if (row.workspace_id === activeWorkspaceId) continue;
    const ws = Array.isArray(row.workspaces)
      ? row.workspaces[0]
      : row.workspaces;
    const entry = counts.get(row.workspace_id) ??
      { name: ws?.name ?? "Another Space", count: 0 };
    entry.count++;
    counts.set(row.workspace_id, entry);
  }
  return {
    activeName,
    others: [...counts.entries()]
      .map(([id, v]) => ({ id, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
