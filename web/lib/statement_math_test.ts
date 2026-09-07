import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  computeStatementMath,
  type StatementTransactionFact,
} from "./statement-math.ts";

function fact(
  over: Partial<StatementTransactionFact> & { id: string },
): StatementTransactionFact {
  return {
    occurredAt: "2026-08-01T00:00:00.000Z",
    direction: "out",
    principalEffectMinor: 0,
    feeEffectMinor: 0,
    balanceAfterMinor: null,
    currency: "RWF",
    ...over,
  };
}

Deno.test("empty facts + a currency hint + known balances: zero totals, reconcile checked", () => {
  const r = computeStatementMath([], {
    currency: "RWF",
    openingBalanceMinor: 1000,
    closingBalanceMinor: 1000,
  });
  assertEquals(r.currency, "RWF");
  assert(r.totals);
  assertEquals(r.totals.totalCreditsMinor, 0);
  assertEquals(r.totals.totalDebitsMinor, 0);
  assertEquals(r.totals.totalFeesMinor, 0);
  assertEquals(r.totals.netMovementMinor, 0);
  assertEquals(r.totals.transactionCount, 0);
  assertEquals(r.totals.reconciles, true);
  assertEquals(r.rows, []);
});

Deno.test("empty facts, no balances: totals present, reconcile not checkable", () => {
  const r = computeStatementMath([], { currency: "RWF" });
  assert(r.totals);
  assertEquals(r.totals.openingBalanceMinor, null);
  assertEquals(r.totals.closingBalanceMinor, null);
  assertEquals(r.totals.reconciles, null);
  assertEquals(r.runningBalanceBasis, "unavailable");
  assertEquals(r.runningBalancesResolved, false);
});

Deno.test("empty facts, no currency hint: nothing to report", () => {
  const r = computeStatementMath([]);
  assertEquals(r.currency, null);
  assertEquals(r.totals, null);
  assertEquals(r.perCurrency, []);
});

Deno.test("credits, debits, fees and net over mixed directions", () => {
  const facts = [
    fact({
      id: "a",
      direction: "in",
      principalEffectMinor: 10_000,
      occurredAt: "2026-08-02T00:00:00.000Z",
    }),
    fact({
      id: "b",
      direction: "out",
      principalEffectMinor: -3_000,
      feeEffectMinor: -100,
      occurredAt: "2026-08-03T00:00:00.000Z",
    }),
    fact({
      id: "c",
      direction: "out",
      principalEffectMinor: -2_000,
      occurredAt: "2026-08-04T00:00:00.000Z",
    }),
    fact({
      id: "d",
      direction: "neutral",
      feeEffectMinor: -50,
      occurredAt: "2026-08-05T00:00:00.000Z",
    }),
  ];
  const r = computeStatementMath(facts, {
    currency: "RWF",
    openingBalanceMinor: 5_000,
  });
  assert(r.totals);
  assertEquals(r.totals.totalCreditsMinor, 10_000);
  assertEquals(r.totals.totalDebitsMinor, 5_000);
  assertEquals(r.totals.totalFeesMinor, 150);
  // 10000 - 3100 - 2000 - 50
  assertEquals(r.totals.netMovementMinor, 4_850);
  assertEquals(r.totals.transactionCount, 4);
});

Deno.test("reconciles is true only when opening + credits - debits - fees === closing", () => {
  const facts = [
    fact({ id: "a", direction: "in", principalEffectMinor: 10_000 }),
    fact({
      id: "b",
      direction: "out",
      principalEffectMinor: -3_000,
      feeEffectMinor: -100,
    }),
    fact({ id: "c", direction: "out", principalEffectMinor: -2_000 }),
  ];
  // 5000 + 10000 - 5000 - 100 = 9900
  const good = computeStatementMath(facts, {
    currency: "RWF",
    openingBalanceMinor: 5_000,
    closingBalanceMinor: 9_900,
  });
  assertEquals(good.totals?.reconciles, true);

  const bad = computeStatementMath(facts, {
    currency: "RWF",
    openingBalanceMinor: 5_000,
    closingBalanceMinor: 9_999,
  });
  assertEquals(bad.totals?.reconciles, false);
});

Deno.test("running balance basis: provider balances on every row win", () => {
  const facts = [
    fact({
      id: "a",
      direction: "in",
      principalEffectMinor: 10_000,
      balanceAfterMinor: 15_000,
      occurredAt: "2026-08-02T00:00:00.000Z",
    }),
    fact({
      id: "b",
      direction: "out",
      principalEffectMinor: -3_000,
      feeEffectMinor: -100,
      balanceAfterMinor: 11_900,
      occurredAt: "2026-08-03T00:00:00.000Z",
    }),
    fact({
      id: "c",
      direction: "out",
      principalEffectMinor: -2_000,
      balanceAfterMinor: 9_900,
      occurredAt: "2026-08-04T00:00:00.000Z",
    }),
  ];
  const r = computeStatementMath(facts, {
    currency: "RWF",
    openingBalanceMinor: 5_000,
  });
  assertEquals(r.runningBalanceBasis, "provider");
  assertEquals(r.rows.map((x) => x.runningBalanceMinor), [
    15_000,
    11_900,
    9_900,
  ]);
});

Deno.test("running balance basis: derived from a known opening when a provider balance is missing", () => {
  const facts = [
    fact({
      id: "a",
      direction: "in",
      principalEffectMinor: 10_000,
      balanceAfterMinor: 15_000,
      occurredAt: "2026-08-02T00:00:00.000Z",
    }),
    fact({
      id: "b",
      direction: "out",
      principalEffectMinor: -3_000,
      feeEffectMinor: -100,
      balanceAfterMinor: null,
      occurredAt: "2026-08-03T00:00:00.000Z",
    }),
    fact({
      id: "c",
      direction: "out",
      principalEffectMinor: -2_000,
      balanceAfterMinor: 9_900,
      occurredAt: "2026-08-04T00:00:00.000Z",
    }),
  ];
  const r = computeStatementMath(facts, {
    currency: "RWF",
    openingBalanceMinor: 5_000,
  });
  assertEquals(r.runningBalanceBasis, "derived");
  assertEquals(r.rows.map((x) => x.runningBalanceMinor), [
    15_000,
    11_900,
    9_900,
  ]);
});

Deno.test("running balance basis: unavailable when there is no provider balance and no opening", () => {
  const facts = [
    fact({ id: "a", direction: "in", principalEffectMinor: 10_000 }),
    fact({ id: "b", direction: "out", principalEffectMinor: -2_000 }),
  ];
  const r = computeStatementMath(facts, { currency: "RWF" });
  assertEquals(r.runningBalanceBasis, "unavailable");
  assertEquals(r.runningBalancesResolved, false);
  assertEquals(r.rows.map((x) => x.runningBalanceMinor), [null, null]);
});

Deno.test("facts are ordered chronologically, id breaking ties", () => {
  const facts = [
    fact({ id: "z", occurredAt: "2026-08-05T00:00:00.000Z" }),
    fact({ id: "m", occurredAt: "2026-08-01T00:00:00.000Z" }),
    fact({ id: "a", occurredAt: "2026-08-01T00:00:00.000Z" }),
    fact({ id: "q", occurredAt: "2026-08-03T00:00:00.000Z" }),
  ];
  const r = computeStatementMath(facts, { currency: "RWF" });
  assertEquals(r.rows.map((x) => x.factId), ["a", "m", "q", "z"]);
});

Deno.test("multi-currency facts: per-currency breakdown, no combined totals, no running balances", () => {
  const facts = [
    fact({
      id: "a",
      currency: "RWF",
      direction: "in",
      principalEffectMinor: 10_000,
    }),
    fact({
      id: "b",
      currency: "RWF",
      direction: "out",
      principalEffectMinor: -4_000,
    }),
    fact({
      id: "c",
      currency: "USD",
      direction: "out",
      principalEffectMinor: -50,
      feeEffectMinor: -1,
    }),
  ];
  const r = computeStatementMath(facts, {
    openingBalanceMinor: 1_000,
    closingBalanceMinor: 2_000,
  });
  assertEquals(r.currency, null);
  assertEquals(r.totals, null);
  assertEquals(r.mixedCurrency, true);
  assertEquals(r.perCurrency.map((c) => c.currency), ["RWF", "USD"]);
  const rwf = r.perCurrency.find((c) => c.currency === "RWF")!;
  assertEquals(rwf.totalCreditsMinor, 10_000);
  assertEquals(rwf.totalDebitsMinor, 4_000);
  assertEquals(rwf.openingBalanceMinor, null);
  assertEquals(rwf.reconciles, null);
  const usd = r.perCurrency.find((c) => c.currency === "USD")!;
  assertEquals(usd.totalDebitsMinor, 50);
  assertEquals(usd.totalFeesMinor, 1);
  assertEquals(r.runningBalanceBasis, "unavailable");
  assertEquals(r.rows.every((x) => x.runningBalanceMinor === null), true);
});

Deno.test("sign robustness: |principal| and |fee| are used regardless of stored sign", () => {
  const facts = [
    // fee given positive by mistake; principal for `out` given positive by mistake
    fact({
      id: "a",
      direction: "out",
      principalEffectMinor: 2_000,
      feeEffectMinor: 30,
    }),
  ];
  const r = computeStatementMath(facts, { currency: "RWF" });
  assertEquals(r.totals?.totalDebitsMinor, 2_000);
  assertEquals(r.totals?.totalFeesMinor, 30);
});

Deno.test("refund (in) and reversal (out) are counted like any other row", () => {
  const facts = [
    fact({ id: "a", direction: "out", principalEffectMinor: -5_000 }),
    fact({ id: "b", direction: "in", principalEffectMinor: 5_000 }), // refund
  ];
  const r = computeStatementMath(facts, { currency: "RWF" });
  assertEquals(r.totals?.transactionCount, 2);
  assertEquals(r.totals?.totalCreditsMinor, 5_000);
  assertEquals(r.totals?.totalDebitsMinor, 5_000);
  assertEquals(r.totals?.netMovementMinor, 0);
});
