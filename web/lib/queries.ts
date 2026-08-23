import "server-only";
import { supabaseSession } from "./supabase-session-server";
import { kigaliDayBoundsUtc, kigaliDateKey } from "./kigali-time";

// Every function here queries through the session-authenticated Supabase
// client (lib/supabase-session-server.ts), never the service-role one -
// Phase B's actual security boundary is RLS, enforced by Postgres for
// whichever workspace(s) the signed-in user is a member of. There is
// deliberately no manual `.eq("workspace_id", ...)` filtering here: adding
// one would either duplicate what RLS already guarantees, or - if it were
// ever wrong - silently mask an RLS bug instead of surfacing it. If a
// caller isn't signed in, these queries simply return nothing (RLS denies
// unauthenticated access to every table here), never an error that could
// leak whether data exists.

export type TransactionRow = {
  id: string;
  transaction_type: string;
  direction: "in" | "out" | "neutral";
  status: string;
  amount_rwf: number;
  fee_rwf: number;
  net_effect_rwf: number;
  balance_after_rwf: number | null;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  occurred_at: string;
  category: string | null;
  subcategory: string | null;
  category_source: string | null;
  settlement_state: string | null;
  affects_balance: boolean | null;
};

const TRANSACTION_COLUMNS =
  "id, transaction_type, direction, status, amount_rwf, fee_rwf, net_effect_rwf, balance_after_rwf, counterparty_name, counterparty_reference, occurred_at, category, subcategory, category_source, settlement_state, affects_balance";

export async function getCurrentBalance(): Promise<number | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select("balance_after_rwf")
    .not("balance_after_rwf", "is", null)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getCurrentBalance failed:", error.message);
    return null;
  }

  return data?.balance_after_rwf ?? null;
}

export type TodayTotals = {
  spentRwf: number;
  receivedRwf: number;
};

export async function getTodayTotals(): Promise<TodayTotals> {
  const supabase = await supabaseSession();
  const todayKey = kigaliDateKey(new Date().toISOString());
  const { startUtc, endUtc } = kigaliDayBoundsUtc(todayKey);

  const { data, error } = await supabase
    .from("transactions")
    .select("direction, principal_effect_rwf, fee_effect_rwf")
    .eq("settlement_state", "settled")
    .gte("occurred_at", startUtc.toISOString())
    .lte("occurred_at", endUtc.toISOString());

  if (error) {
    console.error("getTodayTotals failed:", error.message);
    return { spentRwf: 0, receivedRwf: 0 };
  }

  let spentRwf = 0;
  let receivedRwf = 0;

  for (const row of data ?? []) {
    const effect = Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf);
    if (row.direction === "out") {
      spentRwf += Math.abs(effect);
    } else if (row.direction === "in") {
      receivedRwf += effect;
    }
  }

  return { spentRwf, receivedRwf };
}

export async function getRecentTransactions(
  limit = 8,
): Promise<TransactionRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getRecentTransactions failed:", error.message);
    return [];
  }

  return data ?? [];
}

export async function getTransactions(
  {
    limit = 50,
    offset = 0,
    category,
  }: { limit?: number; offset?: number; category?: string } = {},
): Promise<TransactionRow[]> {
  const supabase = await supabaseSession();
  let query = supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (category === "Uncategorized") {
    query = query.is("category", null);
  } else if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    console.error("getTransactions failed:", error.message);
    return [];
  }

  return data ?? [];
}

export async function getTransactionById(
  id: string,
): Promise<TransactionRow | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getTransactionById failed:", error.message);
    return null;
  }

  return data;
}

export type CategoryTotal = {
  category: string; // "Uncategorized" for null
  totalRwf: number;
  transactionCount: number;
};

export async function getCategoryTotals(): Promise<CategoryTotal[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select("category, principal_effect_rwf, fee_effect_rwf")
    .eq("direction", "out")
    .eq("settlement_state", "settled");

  if (error) {
    console.error("getCategoryTotals failed:", error.message);
    return [];
  }

  const totals = new Map<string, { total: number; count: number }>();

  for (const row of data ?? []) {
    const key = row.category ?? "Uncategorized";
    const effect = Math.abs(
      Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf),
    );
    const existing = totals.get(key) ?? { total: 0, count: 0 };
    totals.set(key, { total: existing.total + effect, count: existing.count + 1 });
  }

  return Array.from(totals.entries())
    .map(([category, { total, count }]) => ({
      category,
      totalRwf: total,
      transactionCount: count,
    }))
    .sort((a, b) => b.totalRwf - a.totalRwf);
}

/**
 * The signed-in user's own workspace_id, resolved from
 * workspace_memberships (RLS-scoped to rows the caller is actually a
 * member of - see is_workspace_member() and workspace_memberships_select_
 * member). Phase C has no team/multi-membership functionality yet, so a
 * user has exactly one active membership in practice; the owner role is
 * required for account/connection creation, so that role is what this
 * resolves.
 */
export async function getOwnedWorkspaceId(): Promise<string | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getOwnedWorkspaceId failed:", error.message);
    return null;
  }

  return data?.workspace_id ?? null;
}

export type AccountRow = {
  id: string;
  name: string;
  provider: string;
  currency: string;
  is_active: boolean;
  is_primary: boolean;
  archived_at: string | null;
};

export async function getAccounts(): Promise<AccountRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, provider, currency, is_active, is_primary, archived_at")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getAccounts failed:", error.message);
    return [];
  }

  return data ?? [];
}

export type IngestionConnectionRow = {
  id: string;
  label: string;
  provider: string;
  status: "active" | "revoked";
  credential_prefix: string;
  last_used_at: string | null;
  created_at: string;
  account_id: string;
  account_name: string;
};

export async function getIngestionConnections(): Promise<
  IngestionConnectionRow[]
> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("ingestion_connections")
    .select(
      // Two FKs link ingestion_connections to accounts (the plain account_id
      // one, and the composite ingestion_connections_account_same_workspace
      // one used only to guarantee same-workspace routing at the database
      // level) - the embed must name the single-column FK explicitly or
      // PostgREST cannot pick one automatically.
      "id, label, provider, status, credential_prefix, last_used_at, created_at, account_id, accounts!ingestion_connections_account_id_fkey(name)",
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getIngestionConnections failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const account = row.accounts as unknown as { name: string } | null;
    return {
      id: row.id,
      label: row.label,
      provider: row.provider,
      status: row.status,
      credential_prefix: row.credential_prefix,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      account_id: row.account_id,
      account_name: account?.name ?? "Unknown account",
    };
  });
}
