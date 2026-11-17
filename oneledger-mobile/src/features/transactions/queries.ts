import { supabase } from "@/api/supabase";
import { kigaliDateKey, kigaliDayBoundsUtc } from "@/lib/kigali-time";

import { NO_FILTERS, periodStartUtc, type TransactionFilters } from "./filters";
import { sumLifetimeFlow, type LifetimeFlow, type LifetimeRow } from "./lifetime";
import { pickPlausibleBalance, safeSearchTerm, sumTodayTotals } from "./display";
import { computeLocalBalance } from "@/offline/balance";
import { getLocalTransaction, listLocalTransactions, type LocalTransaction } from "@/offline/local-store";
import { readableDb } from "@/offline/runtime";

// Read queries, ported from web/lib/queries.ts. Like the web, every query
// runs as the signed-in user and relies on Row Level Security for scoping:
// there is deliberately no manual workspace filter here. Rows merged into a
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

export async function getCurrentBalance(): Promise<CurrentBalance | null> {
  const local = readableDb();
  if (local) {
    const rows = await local.all<{
      id: string; occurred_at: string; balance_after_rwf: number | null; principal_effect_rwf: number | null;
      fee_effect_rwf: number | null; settlement_state: string | null; sync_state: string; direction: string; dedupe_state: string;
    }>(
      "SELECT id, occurred_at, balance_after_rwf, principal_effect_rwf, fee_effect_rwf, settlement_state, sync_state, direction, dedupe_state FROM transactions WHERE dedupe_state <> 'merged' ORDER BY occurred_at DESC",
    );
    const confirmedRows = rows
      .filter((r) => r.sync_state === "synced" && r.balance_after_rwf !== null)
      .slice(0, 5)
      .map((r) => ({ ...r, balance_after_rwf: r.balance_after_rwf as number }));
    const confirmed = pickPlausibleBalance(confirmedRows);
    if (!confirmed) return null;
    const { pendingEffectRwf, pendingCount } = computeLocalBalance(rows);
    return { ...confirmed, pendingEffectRwf, pendingCount };
  }
  const { data, error } = await client()
    .from("transactions")
    .select("balance_after_rwf, occurred_at, direction, principal_effect_rwf")
    .not("balance_after_rwf", "is", null)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    // A handful, not just the newest: see pickPlausibleBalance.
    .limit(5);
  if (error) throw new QueryError(error.message);
  return pickPlausibleBalance(data ?? []);
}

export async function getTodayTotals(
  nowIso: string,
): Promise<{ spentRwf: number; receivedRwf: number }> {
  const { startUtc, endUtc } = kigaliDayBoundsUtc(kigaliDateKey(nowIso));
  const local = readableDb();
  if (local) {
    // Includes entries saved on this device that are still syncing; failed ones are excluded.
    const rows = await local.all<{ direction: string; principal_effect_rwf: number | null; fee_effect_rwf: number | null }>(
      "SELECT direction, principal_effect_rwf, fee_effect_rwf FROM transactions WHERE settlement_state = 'settled' AND dedupe_state <> 'merged' AND sync_state <> 'failed' AND occurred_at >= ? AND occurred_at <= ?",
      [startUtc.toISOString(), endUtc.toISOString()],
    );
    return sumTodayTotals(rows);
  }
  const { data, error } = await client()
    .from("transactions")
    .select("direction, principal_effect_rwf, fee_effect_rwf")
    .eq("settlement_state", "settled")
    .neq("dedupe_state", "merged")
    .gte("occurred_at", startUtc.toISOString())
    .lte("occurred_at", endUtc.toISOString());
  if (error) throw new QueryError(error.message);
  return sumTodayTotals(data ?? []);
}

export async function getTransactions({
  offset = 0,
  limit = TRANSACTIONS_PAGE_SIZE,
  q,
  filters = NO_FILTERS,
  category,
  nowIso = new Date().toISOString(),
}: {
  offset?: number;
  limit?: number;
  q?: string;
  filters?: TransactionFilters;
  /** Exactly this category; "Uncategorized" means none, like the web's ?category=. */
  category?: string;
  nowIso?: string;
} = {}): Promise<TransactionRow[]> {
  const local = readableDb();
  if (local) {
    const term = q ? safeSearchTerm(q) : "";
    const since = periodStartUtc(filters.period, nowIso);
    const rows = await listLocalTransactions(local, {
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
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

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
  const local = readableDb();
  if (local) {
    const row = await getLocalTransaction(local, id);
    return row ? fromLocal(row) : null;
  }
  const { data, error } = await client()
    .from("transactions")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new QueryError(error.message);
  return (data as TransactionRow | null) ?? null;
}

export async function getReviewQueue(): Promise<TransactionRow[]> {
  const { data, error } = await client()
    .from("transactions")
    .select(COLUMNS)
    .in("category_decision_status", REVIEW_STATUSES)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) throw new QueryError(error.message);
  return (data ?? []) as TransactionRow[];
}

export async function getReviewQueueCount(): Promise<number> {
  const { count, error } = await client()
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .in("category_decision_status", REVIEW_STATUSES);
  if (error) throw new QueryError(error.message);
  return count ?? 0;
}

export type LifetimeTotals = LifetimeFlow & { accountCreatedIso: string | null };

const LIFETIME_PAGE = 1000;
// A runaway guard (50,000 transactions), not a limit anyone should reach.
const LIFETIME_MAX_PAGES = 50;

/**
 * All-time totals sent and received (web `getLifetimeFlowTotals`): settled
 * transactions, merged duplicates excluded. Read a page at a time because the
 * API returns at most 1,000 rows per request; summing one request would
 * silently stop at 1,000 transactions.
 */
export async function getLifetimeFlowTotals(): Promise<LifetimeTotals> {
  const db = client();
  const rows: LifetimeRow[] = [];
  for (let page = 0; page < LIFETIME_MAX_PAGES; page++) {
    const { data, error } = await db
      .from("transactions")
      .select("direction, principal_effect_rwf, fee_effect_rwf")
      .eq("settlement_state", "settled")
      .neq("dedupe_state", "merged")
      // A stable order, or pages can overlap or skip rows.
      .order("id", { ascending: true })
      .range(page * LIFETIME_PAGE, (page + 1) * LIFETIME_PAGE - 1);
    if (error) throw new QueryError(error.message);
    rows.push(...((data ?? []) as LifetimeRow[]));
    if (!data || data.length < LIFETIME_PAGE) break;
  }
  const { data: userData } = await db.auth.getUser();
  return { ...sumLifetimeFlow(rows), accountCreatedIso: userData.user?.created_at ?? null };
}
