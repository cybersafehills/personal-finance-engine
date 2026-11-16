import { supabase } from "@/api/supabase";
import { kigaliDateKey, kigaliDayBoundsUtc } from "@/lib/kigali-time";

import { NO_FILTERS, periodStartUtc, type TransactionFilters } from "./filters";
import { sumLifetimeFlow, type LifetimeFlow, type LifetimeRow } from "./lifetime";
import { pickPlausibleBalance, safeSearchTerm, sumTodayTotals } from "./display";

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
};

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

export type CurrentBalance = { amountRwf: number; asOfIso: string };

export async function getCurrentBalance(): Promise<CurrentBalance | null> {
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
  nowIso = new Date().toISOString(),
}: {
  offset?: number;
  limit?: number;
  q?: string;
  filters?: TransactionFilters;
  nowIso?: string;
} = {}): Promise<TransactionRow[]> {
  let query = client()
    .from("transactions")
    .select(COLUMNS)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

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
