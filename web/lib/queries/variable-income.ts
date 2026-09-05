import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { kigaliDateKey, kigaliDayBoundsUtc } from "../kigali-time";
import { lastNCompleteMonthKeys } from "../budget-math";

// Variable-income candidate reads: the previous N complete Kigali-calendar
// months of settled inflows, for a workspace owner to inspect/exclude
// before accepting a recommended baseline (the averaging/minimum logic
// itself is in web/lib/budget-math.ts). Leaf domain peeled out of
// web/lib/queries.ts (assessment item 10); re-exported from there so
// existing imports keep working.

export type VariableIncomeTransaction = {
  id: string;
  occurredAt: string;
  counterpartyName: string | null;
  amountMinor: number;
};

export type VariableIncomeMonth = {
  monthKey: string;
  transactions: VariableIncomeTransaction[];
};

function lastDayOfMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Complete calendar months are Kigali-calendar months entirely before
 * the current one - the current, still-in-progress month is never
 * included (matching the product spec's own "previous 3 complete
 * months" wording). Months with zero qualifying transactions are simply
 * absent from the result, not included as an empty/zero entry - callers
 * feed only the months with actual data into
 * computeVariableIncomeRecommendation().
 */
export async function getVariableIncomeMonths(
  currency: string,
  monthsBack = 3,
): Promise<VariableIncomeMonth[]> {
  const supabase = await supabaseSession();
  const todayMonthKey = kigaliDateKey(new Date().toISOString()).slice(0, 7);
  const monthKeys = lastNCompleteMonthKeys(todayMonthKey, monthsBack);
  if (monthKeys.length === 0) return [];

  const firstMonthKey = monthKeys[0];
  const lastMonthKey = monthKeys[monthKeys.length - 1];
  const { startUtc } = kigaliDayBoundsUtc(`${firstMonthKey}-01`);
  const { endUtc } = kigaliDayBoundsUtc(
    `${lastMonthKey}-${String(lastDayOfMonth(lastMonthKey)).padStart(2, "0")}`,
  );

  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, occurred_at, counterparty_name, principal_effect_rwf, fee_effect_rwf",
    )
    .eq("currency", currency)
    .eq("direction", "in")
    .eq("settlement_state", "settled")
    // Phase U: exclude rows merged into a canonical duplicate.
    .neq("dedupe_state", "merged")
    .gte("occurred_at", startUtc.toISOString())
    .lte("occurred_at", endUtc.toISOString())
    .order("occurred_at", { ascending: true });

  if (error) {
    console.error("getVariableIncomeMonths failed:", error.message);
    return [];
  }

  const byMonth = new Map<string, VariableIncomeTransaction[]>();
  for (const row of data ?? []) {
    const monthKey = kigaliDateKey(row.occurred_at).slice(0, 7);
    if (!monthKeys.includes(monthKey)) continue; // defensive: excludes any boundary row outside the intended months
    const amountMinor = Math.abs(
      Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf),
    );
    const existing = byMonth.get(monthKey) ?? [];
    existing.push({
      id: row.id,
      occurredAt: row.occurred_at,
      counterpartyName: row.counterparty_name,
      amountMinor,
    });
    byMonth.set(monthKey, existing);
  }

  return monthKeys
    .filter((key) => byMonth.has(key))
    .map((monthKey) => ({ monthKey, transactions: byMonth.get(monthKey)! }));
}
