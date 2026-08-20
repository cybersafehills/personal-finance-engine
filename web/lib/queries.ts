import "server-only";
import { supabaseServer } from "./supabase-server";
import { kigaliDayBoundsUtc, kigaliDateKey } from "../../supabase/functions/_shared/kigali-time.ts";

// Every function here reads from the existing `transactions` table only -
// no second balance calculation, no accounting logic. Current balance uses
// MTN's own reported balance_after_rwf. Today's totals and category totals
// use the accounting-effect columns Phase 4.2 already populates
// (principal_effect_rwf / fee_effect_rwf), never recomputed here.

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
  const supabase = supabaseServer();
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
  const supabase = supabaseServer();
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
  const supabase = supabaseServer();
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
  const supabase = supabaseServer();
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
  const supabase = supabaseServer();
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
  const supabase = supabaseServer();
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
