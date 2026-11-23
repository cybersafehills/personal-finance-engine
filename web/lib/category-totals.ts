import { minor } from "../shared/financial.ts";
// Category totals ("where your money has gone"), as pure functions so they can be
// unit-tested with `deno test` (category_totals_test.ts).
//
// Supabase's REST API returns at most `max_rows` rows per request (1000 in
// supabase/config.toml), so reading every settled outgoing transaction in ONE
// request silently drops everything past the first 1000: the totals were wrong,
// with no error, for anyone with a longer history. `collectPages` reads the rows
// a page at a time until the table is exhausted (or a safety cap is hit, in
// which case it says so instead of pretending the result is complete).

export type CategoryTotal = {
  category: string; // "Uncategorized" for null
  totalRwf: number;
  transactionCount: number;
};

export type TotalsRow = {
  category: string | null;
  principal_effect_rwf: number | string | null;
  fee_effect_rwf: number | string | null;
};

/** Sum |principal + fee| per category, largest first. */
export function aggregateCategoryTotals(rows: readonly TotalsRow[]): CategoryTotal[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const key = row.category ?? "Uncategorized";
    if (row.principal_effect_rwf === null || row.fee_effect_rwf === null) throw new Error("Category accounting is unavailable.");
    const signed = minor(row.principal_effect_rwf) + minor(row.fee_effect_rwf);
    const effect = Number(signed < 0n ? -signed : signed);
    if (!Number.isSafeInteger(effect)) throw new RangeError("unsafe_money_total");
    const existing = totals.get(key) ?? { total: 0, count: 0 };
    const total = existing.total + effect;
    if (!Number.isSafeInteger(total)) throw new RangeError("unsafe_money_total");
    totals.set(key, { total, count: existing.count + 1 });
  }
  return Array.from(totals.entries())
    .map(([category, { total, count }]) => ({ category, totalRwf: total, transactionCount: count }))
    .sort((a, b) => b.totalRwf - a.totalRwf);
}

export type PagedRows<T> = { rows: T[]; truncated: boolean };

/**
 * Reads `fetchPage(from, to)` (inclusive range) until the data runs out.
 *
 * It advances by the rows it actually RECEIVED and stops only on an EMPTY page.
 * It must not treat a short page as the end: that is only true if the server's
 * row cap (`max_rows`) is at least `pageSize`, and a lower cap (unverified for
 * production) would make the first page "short" and stop early, reporting a
 * partial result as complete. The price is one extra, empty request at the end.
 *
 * Stops at `maxPages`; if rows were still coming, `truncated` is true so the
 * caller can say the result is incomplete. A failing page throws, so a partial
 * result is never returned as if it were whole.
 */
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
  maxPages = 50,
): Promise<PagedRows<T>> {
  const rows: T[] = [];
  let from = 0;
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(from, from + pageSize - 1);
    if (batch.length === 0) return { rows, truncated: false };
    rows.push(...batch);
    from += batch.length;
  }
  return { rows, truncated: true };
}
