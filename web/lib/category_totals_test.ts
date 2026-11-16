import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { aggregateCategoryTotals, collectPages } from "./category-totals.ts";

const row = (category: string | null, principal: number | string | null, fee: number | string | null = 0) => ({
  category,
  principal_effect_rwf: principal,
  fee_effect_rwf: fee,
});

Deno.test("sums principal plus fee per category, largest first", () => {
  assertEquals(
    aggregateCategoryTotals([row("Food", -1000, -50), row("Food", -500, 0), row("Transport", -4000, -100)]),
    [
      { category: "Transport", totalRwf: 4100, transactionCount: 1 },
      { category: "Food", totalRwf: 1550, transactionCount: 2 },
    ],
  );
});

Deno.test("a null category is Uncategorized, and numeric strings are read as numbers", () => {
  assertEquals(aggregateCategoryTotals([row(null, "-300", "-30"), row(null, -70, 0)]), [
    { category: "Uncategorized", totalRwf: 400, transactionCount: 2 },
  ]);
});

Deno.test("no rows is no totals", () => {
  assertEquals(aggregateCategoryTotals([]), []);
});

// A fake table: rows 0..n-1, served in ranges like PostgREST does.
const table = (n: number, cap = 1000) => {
  const calls: Array<[number, number]> = [];
  return {
    calls,
    fetchPage: (from: number, to: number) => {
      calls.push([from, to]);
      const end = Math.min(to, from + cap - 1, n - 1);
      return Promise.resolve(from > end ? [] : Array.from({ length: end - from + 1 }, (_, i) => from + i));
    },
  };
};

Deno.test("reads every row of a table longer than one page (the 1000-row cap)", async () => {
  const t = table(2500);
  const { rows, truncated } = await collectPages(t.fetchPage, 1000, 50);
  assertEquals(rows.length, 2500);
  assertEquals(rows[0], 0);
  assertEquals(rows[2499], 2499);
  assertEquals(truncated, false);
  assertEquals(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

Deno.test("a short table is one request", async () => {
  const t = table(10);
  assertEquals((await collectPages(t.fetchPage)).rows.length, 10);
  assertEquals(t.calls.length, 1);
});

Deno.test("an exact multiple of the page size needs one empty page to know it is done", async () => {
  const t = table(2000);
  const { rows, truncated } = await collectPages(t.fetchPage, 1000, 50);
  assertEquals([rows.length, truncated], [2000, false]);
  assertEquals(t.calls.length, 3);
});

Deno.test("an empty table is empty, not truncated", async () => {
  assertEquals(await collectPages(table(0).fetchPage), { rows: [], truncated: false });
});

Deno.test("hitting the safety cap says so instead of returning a partial total as complete", async () => {
  const { rows, truncated } = await collectPages(table(10_000).fetchPage, 1000, 3);
  assertEquals(rows.length, 3000);
  assertEquals(truncated, true);
});

Deno.test("a failing page throws, never a silent partial result", async () => {
  let n = 0;
  await assertRejects(() =>
    collectPages((_from, _to) => (++n === 2 ? Promise.reject(new Error("boom")) : Promise.resolve(new Array(1000).fill(0))))
  );
});
