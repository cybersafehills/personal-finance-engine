import { assertEquals } from "jsr:@std/assert@1";
import { buildWalletForecast, type ForecastTxn } from "./wallet-forecast.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const ago = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const tx = (
  id: string,
  direction: "in" | "out",
  amountMinor: number,
  daysAgo: number,
  who = "Shop",
): ForecastTxn => ({
  id,
  direction,
  settled: true,
  counterpartyName: `${who}${id}`,
  category: null,
  amountMinor,
  occurredAt: ago(daysAgo),
});
const base = { currency: "RWF", dueBills: [], nowMs: NOW, truncated: false };

// 30 outs of 1,000 and 6 ins of 5,000 across ~85 days.
const busy: ForecastTxn[] = [
  ...Array.from({ length: 30 }, (_, i) => tx(`o${i}`, "out", 1_000, 2 + i * 3)),
  ...Array.from({ length: 6 }, (_, i) => tx(`i${i}`, "in", 5_000, 4 + i * 14)),
];

Deno.test("each wallet's forecast uses only its own transactions", () => {
  const a = buildWalletForecast({ ...base, balanceMinor: 50_000, txns: busy });
  const b = buildWalletForecast({ ...base, balanceMinor: 7_000, txns: [] });
  assertEquals(a.forecast!.openingBalanceMinor, 50_000);
  assertEquals(b.forecast!.openingBalanceMinor, 7_000);
  // No history for B: no spending and no income estimate, so it stays flat.
  assertEquals(b.forecast!.projectedEnd.estimatedBalanceMinor, 7_000);
  assertEquals(b.rates.dailyOutMinor, 0);
});

Deno.test("with history, the estimate sits at or above the no-income end", () => {
  const a = buildWalletForecast({ ...base, balanceMinor: 50_000, txns: busy });
  const f = a.forecast!;
  assertEquals(
    f.projectedEnd.noIncomeBalanceMinor <= f.projectedEnd.estimatedBalanceMinor,
    true,
  );
  assertEquals(
    f.projectedEnd.noIncomeBalanceMinor < f.openingBalanceMinor,
    true,
  );
});

Deno.test("no trusted balance: recurring is still detected but no forecast is built", () => {
  const r = buildWalletForecast({ ...base, balanceMinor: null, txns: busy });
  assertEquals(r.forecast, null);
});

Deno.test("a windfall is reported in the basis", () => {
  const txns = [...busy, tx("big", "in", 900_000, 20)];
  const r = buildWalletForecast({ ...base, balanceMinor: 50_000, txns });
  assertEquals(r.rates.windfallCount, 1);
  assertEquals(r.forecast!.basis.some((l) => l.includes("left out")), true);
});
