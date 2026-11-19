import { currencyFlows, completePages, type FinancialRow, type CurrencyFlow } from "../../../../shared/financial";
import { selectedWorkspaceId } from "@/features/spaces/selected-space";
import { assertCachedAccess } from "@/offline/visibility";
import { supabase } from "@/api/supabase";
import { kigaliDateKey, kigaliDayBoundsUtc } from "@/lib/kigali-time";

import { NO_FILTERS, periodStartUtc, type TransactionFilters } from "./filters";
import { type LifetimeFlow } from "./lifetime";
import { pickPlausibleBalance, safeSearchTerm } from "./display";
import { computeLocalBalance } from "@/offline/balance";
import { getLocalTransaction, listLocalTransactions, type LocalTransaction } from "@/offline/local-store";
import { readableDb } from "@/offline/runtime";

// Read queries, ported from web/lib/queries.ts. Like the web, every query
// runs as the signed-in user and relies on Row Level Security for scoping:
// selected Space is also filtered explicitly. Rows merged into a
// canonical duplicate (`dedupe_state = 'merged'`) are evidence, never live
// transactions, and are excluded everywhere.

export type TransactionRow = {
  id: string;
  transaction_type: string;
  direction: "in" | "out" | "neutral";
  status: string;
  currency: string;
  amount_rwf: number;
  fee_rwf: number;
  balance_after_rwf: number | null;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  occurred_at: string;
  category: string | null;
  subcategory: string | null;
  category_decision_status: string;
  suggested_category: string | null;
  /** Present for rows read from this device: whether the server has this change yet. */
  sync_state?: "local_only" | "pending" | "syncing" | "synced" | "conflict" | "failed";
  sync_error?: string | null;
};

function fromLocal(row: LocalTransaction): TransactionRow {
  return {
    id: row.id,
    transaction_type: row.transaction_type,
    direction: row.direction as TransactionRow["direction"],
    status: row.status,
    currency: row.currency,
    amount_rwf: row.amount_rwf,
    fee_rwf: row.fee_rwf,
    balance_after_rwf: row.balance_after_rwf,
    counterparty_name: row.counterparty_name,
    counterparty_reference: row.counterparty_reference,
    occurred_at: row.occurred_at,
    category: row.category,
    subcategory: row.subcategory,
    category_decision_status: row.category_decision_status,
    suggested_category: row.suggested_category,
    sync_state: row.sync_state,
    sync_error: row.sync_error,
  };
}

const COLUMNS =
  "id, transaction_type, direction, status, currency, amount_rwf, fee_rwf, balance_after_rwf, counterparty_name, counterparty_reference, occurred_at, category, subcategory, category_decision_status, suggested_category";

const REVIEW_STATUSES = ["provisional", "suggested", "conflict"];

export const TRANSACTIONS_PAGE_SIZE = 50;

/** Thrown for any failed read; screens show a retry state. */
export class QueryError extends Error {}

function client() {
  if (!supabase) throw new QueryError("This build isn't connected to OneLedger yet.");
  return supabase;
}

export type CurrentBalance = {
  /** The provider-confirmed figure (from synced transactions). */
  amountRwf: number;
  asOfIso: string;
  /** Net effect of entries saved on this device that the server hasn't confirmed; 0 or absent when none. */
  pendingEffectRwf?: number;
  pendingCount?: number;
};

export async function getCurrentBalance(accountId?: string): Promise<CurrentBalance | null> {
  const workspaceId = selectedWorkspaceId();
  const local = readableDb();
  if (local) {
    await assertCachedAccess(local, workspaceId);
    const rows = await local.all<{
      id: string; occurred_at: string; balance_after_rwf: number | null; principal_effect_rwf: number | null;
      fee_effect_rwf: number | null; settlement_state: string | null; sync_state: string; direction: string; dedupe_state: string; server_updated_at: string | null;
    }>(
      "SELECT id, occurred_at, balance_after_rwf, principal_effect_rwf, fee_effect_rwf, settlement_state, sync_state, direction, dedupe_state, server_updated_at FROM transactions WHERE workspace_id = ? AND currency = 'RWF' AND visibility_revoked = 0 AND (? IS NULL OR account_id = ?) AND dedupe_state <> 'merged' ORDER BY occurred_at DESC",
      [workspaceId, accountId ?? null, accountId ?? null],
    );
    const confirmedRows = rows
      .filter((r) => (r.sync_state === "synced" || r.server_updated_at !== null) && r.balance_after_rwf !== null)
      .slice(0, 5)
      .map((r) => ({ ...r, balance_after_rwf: r.balance_after_rwf as number }));
    const confirmed = pickPlausibleBalance(confirmedRows);
    if (!confirmed) return null;
    const { pendingEffectRwf, pendingCount } = computeLocalBalance(rows);
    return { ...confirmed, pendingEffectRwf, pendingCount };
  }
  let query = client()
    .from("transactions")
    .select("balance_after_rwf, occurred_at, direction, principal_effect_rwf")
    .eq("workspace_id", workspaceId)
    .eq("currency", "RWF")
    .not("balance_after_rwf", "is", null)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    // A handful, not just the newest: see pickPlausibleBalance.
    .limit(5);
  if (accountId) query = query.eq("account_id", accountId);
  const { data, error } = await query;
  if (error) throw new QueryError(error.message);
  return pickPlausibleBalance(data ?? []);
}

export async function getTodayTotals(nowIso: string, accountId?: string): Promise<{ spentRwf: number; receivedRwf: number; byCurrency: CurrencyFlow[] }> {
  const workspaceId = selectedWorkspaceId();
  const { startUtc, endUtc } = kigaliDayBoundsUtc(kigaliDateKey(nowIso));
  const local = readableDb();
  let rows: FinancialRow[];
  if (local) {
    await assertCachedAccess(local, workspaceId);
    rows = await local.all<FinancialRow>(
      "SELECT * FROM transactions WHERE workspace_id = ? AND visibility_revoked = 0 AND (? IS NULL OR account_id = ?) AND occurred_at >= ? AND occurred_at <= ?",
      [workspaceId, accountId ?? null, accountId ?? null, startUtc.toISOString(), endUtc.toISOString()]);
  } else {
    rows = await completePages<FinancialRow>(async (offset, size) => {
      let query = client().from("financial_activity_v").select("id,currency,direction,principal_effect_rwf,fee_effect_rwf,settlement_state,dedupe_state,is_own_transfer")
        .eq("workspace_id", workspaceId).gte("occurred_at", startUtc.toISOString()).lte("occurred_at", endUtc.toISOString()).order("id");
      if (accountId) query = query.eq("account_id", accountId);
      const { data, error } = await query.range(offset, offset + size - 1);
      if (error) throw new QueryError(error.message);
      return data ?? [];
    });
  }
  const byCurrency = currencyFlows(rows);
  const rwf = byCurrency.find((r) => r.currency === "RWF");
  return { spentRwf: rwf?.sentMinor ?? 0, receivedRwf: rwf?.receivedMinor ?? 0, byCurrency };
}

export async function getTransactions({
  offset = 0,
  limit = TRANSACTIONS_PAGE_SIZE,
  q,
  filters = NO_FILTERS,
  category,
  nowIso = new Date().toISOString(),
  accountId,
}: {
  offset?: number;
  limit?: number;
  q?: string;
  filters?: TransactionFilters;
  /** Exactly this category; "Uncategorized" means none, like the web's ?category=. */
  category?: string;
  nowIso?: string;
  accountId?: string;
} = {}): Promise<TransactionRow[]> {
  const workspaceId = selectedWorkspaceId();
  const local = readableDb();
  if (local) {
    await assertCachedAccess(local, workspaceId);
    const term = q ? safeSearchTerm(q) : "";
    const since = periodStartUtc(filters.period, nowIso);
    const rows = await listLocalTransactions(local, {
      workspaceId, accountId,
      limit,
      offset,
      category,
      q: term || undefined,
      direction: filters.direction !== "all" ? filters.direction : undefined,
      needsReview: filters.needsReview || undefined,
      sinceIso: since ?? undefined,
    });
    return rows.map(fromLocal);
  }
  let query = client()
    .from("transactions")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (accountId) query = query.eq("account_id", accountId);
  if (category) {
    query = category === "Uncategorized" ? query.is("category", null) : query.eq("category", category);
  }
  if (filters.direction !== "all") query = query.eq("direction", filters.direction);
  if (filters.needsReview) query = query.in("category_decision_status", REVIEW_STATUSES);
  const since = periodStartUtc(filters.period, nowIso);
  if (since) query = query.gte("occurred_at", since);

  const term = q ? safeSearchTerm(q) : "";
  if (term) {
    query = query.or(
      `counterparty_name.ilike.%${term}%,counterparty_reference.ilike.%${term}%,category.ilike.%${term}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw new QueryError(error.message);
  return (data ?? []) as TransactionRow[];
}

export async function getTransactionById(id: string): Promise<TransactionRow | null> {
  const workspaceId = selectedWorkspaceId();
  const local = readableDb();
  if (local) {
    await assertCachedAccess(local, workspaceId);
    const row = await getLocalTransaction(local, id);
    return row && row.workspace_id === workspaceId && !row.visibility_revoked ? fromLocal(row) : null;
  }
  const { data, error } = await client()
    .from("transactions")
    .select(COLUMNS)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new QueryError(error.message);
  return (data as TransactionRow | null) ?? null;
}

export async function getReviewQueue(): Promise<TransactionRow[]> {
  const workspaceId = selectedWorkspaceId();
  const { data, error } = await client()
    .from("transactions")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .in("category_decision_status", REVIEW_STATUSES)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) throw new QueryError(error.message);
  return (data ?? []) as TransactionRow[];
}

export async function getReviewQueueCount(): Promise<number> {
  const workspaceId = selectedWorkspaceId();
  const { count, error } = await client()
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .in("category_decision_status", REVIEW_STATUSES);
  if (error) throw new QueryError(error.message);
  return count ?? 0;
}

export type LifetimeTotals = LifetimeFlow & { accountCreatedIso: string | null };

export async function getLifetimeFlowTotals(): Promise<LifetimeTotals & { byCurrency: CurrencyFlow[] }> {
  const workspaceId = selectedWorkspaceId();
  const local = readableDb();
  if (local) {
    await assertCachedAccess(local, workspaceId);
    const rows = await local.all<FinancialRow>("SELECT * FROM transactions WHERE workspace_id = ? AND visibility_revoked = 0", [workspaceId]);
    const byCurrency = currencyFlows(rows);
    const rwf = byCurrency.find((r) => r.currency === "RWF");
    return { sentRwf: rwf?.sentMinor ?? 0, receivedRwf: rwf?.receivedMinor ?? 0, count: byCurrency.reduce((n,r) => n + r.count, 0), accountCreatedIso: null, byCurrency };
  }
  const rows = await completePages<FinancialRow>(async (offset, size) => {
    const { data, error } = await client().from("financial_activity_v")
      .select("id,currency,direction,principal_effect_rwf,fee_effect_rwf,settlement_state,dedupe_state,is_own_transfer")
      .eq("workspace_id", workspaceId).order("id").range(offset, offset + size - 1);
    if (error) throw new QueryError(error.message);
    return data ?? [];
  });
  const byCurrency = currencyFlows(rows);
  const rwf = byCurrency.find((r) => r.currency === "RWF");
  const { data } = await client().auth.getUser();
  return { sentRwf: rwf?.sentMinor ?? 0, receivedRwf: rwf?.receivedMinor ?? 0,
    count: byCurrency.reduce((n, r) => n + r.count, 0), accountCreatedIso: data.user?.created_at ?? null, byCurrency };
}
