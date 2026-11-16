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
    const effect = Math.abs(Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf));
    const existing = totals.get(key) ?? { total: 0, count: 0 };
    totals.set(key, { total: existing.total + effect, count: existing.count + 1 });
  }
  return Array.from(totals.entries())
    .map(([category, { total, count }]) => ({ category, totalRwf: total, transactionCount: count }))
    .sort((a, b) => b.totalRwf - a.totalRwf);
}

export type PagedRows<T> = { rows: T[]; truncated: boolean };

/**
 * Reads `fetchPage(from, to)` (inclusive range) page by page until a short page
 * ends the data. Stops at `maxPages`; if the last page was still full, more
 * data may exist and `truncated` is true. A failing page throws, so a partial
 * result is never returned as if it were complete.
 */
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
  maxPages = 50,
): Promise<PagedRows<T>> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const batch = await fetchPage(from, from + pageSize - 1);
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
