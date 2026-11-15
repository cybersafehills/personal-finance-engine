import { assertEquals } from "jsr:@std/assert@1";
import {
  applyDrilldown,
  classify,
  compare,
  computeOverview,
  computeTrend,
  type InsightFact,
  type InsightScope,
} from "./insights-math.ts";
import { computeFinancialSnapshot } from "../report-math.ts";

const scope: InsightScope = {
  from: "2026-08-01T00:00:00Z",
  to: "2026-09-01T00:00:00Z",
};
let n = 0;
function f(o: Partial<InsightFact>): InsightFact {
  return {
    id: `t${++n}`,
    direction: "out",
    principalEffectRwf: -1000,
    feeEffectRwf: 0,
    category: "Food",
    transactionType: "merchant_payment",
    counterpartyName: "Shop A",
    accountId: "acc1",
    currency: "RWF",
    settlement: "settled",
    occurredAt: "2026-08-10T10:00:00Z",
    ...o,
  };
}
const none = new Set<string>();

// Hand-computed fixture. Expected values are written out, not derived.
function fixture(): { facts: InsightFact[]; linked: Set<string> } {
  const facts = [
    f({
      id: "salary",
      direction: "in",
      principalEffectRwf: 500000,
      category: "Salary",
      transactionType: "money_received",
      counterpartyName: "Employer",
    }),
    f({
      id: "food1",
      principalEffectRwf: -10000,
      feeEffectRwf: -100,
      category: "Food",
    }),
    f({ id: "food2", principalEffectRwf: -5000, category: "Food" }),
    f({
      id: "rent",
      principalEffectRwf: -200000,
      feeEffectRwf: -1000,
      category: "Rent",
      counterpartyName: "Landlord",
      transactionType: "send_money",
    }),
    f({
      id: "atm",
      principalEffectRwf: -50000,
      feeEffectRwf: -500,
      category: null,
      transactionType: "cash_withdrawal",
      counterpartyName: null,
    }),
    f({
      id: "refund",
      direction: "in",
      principalEffectRwf: 4000,
      category: "Food",
      transactionType: "refund",
      counterpartyName: "Shop A",
    }),
    // internal transfer pair between own accounts
    f({
      id: "tr_out",
      principalEffectRwf: -30000,
      category: "Transfer",
      accountId: "acc1",
    }),
    f({
      id: "tr_in",
      direction: "in",
      principalEffectRwf: 30000,
      category: "Transfer",
      transactionType: "money_received",
      accountId: "acc2",
    }),
    f({ id: "pend", principalEffectRwf: -7000, settlement: "pending" }),
    f({ id: "fail", principalEffectRwf: -9000, settlement: "failed" }),
    f({
      id: "outside",
      principalEffectRwf: -99999,
      occurredAt: "2026-09-01T00:00:00Z",
    }),
    f({ id: "usd", principalEffectRwf: -5, currency: "USD" }),
  ];
  return { facts, linked: new Set(["tr_out", "tr_in"]) };
}

Deno.test("exact totals on hand-computed fixture", () => {
  const { facts, linked } = fixture();
  const o = computeOverview(facts, scope, linked);
  const rwf = o.currencies.find((c) => c.currency === "RWF")!;
  // out = food1 10100 + food2 5000 + rent 201000 + atm 50500 - refund 4000
  assertEquals(rwf.moneyInMinor, 500000n);
  assertEquals(rwf.moneyOutMinor, 262600n);
  assertEquals(rwf.netMinor, 237400n);
  assertEquals(rwf.refundsMinor, 4000n);
  assertEquals(rwf.cashOutMinor, 50500n);
  assertEquals(rwf.consumptionOutMinor, 212100n);
  assertEquals(rwf.transfersExcluded, { amountMinor: 30000n, count: 2 });
  assertEquals(rwf.pending, { amountMinor: 7000n, count: 1 });
  assertEquals(rwf.failedCount, 1);
  const cats = Object.fromEntries(
    rwf.byCategory.map((c) => [c.category, c.amountMinor]),
  );
  assertEquals(cats, { Food: 11100n, Rent: 201000n, "Cash out": 50500n });
  assertEquals(rwf.byCategory[0].category, "Rent");
  assertEquals(rwf.byCategory[0].percentBps, 7654); // 201000/262600 = 76.54%, truncated
});

Deno.test("currencies are never mixed", () => {
  const { facts, linked } = fixture();
  const o = computeOverview(facts, scope, linked);
  assertEquals(o.currencies.map((c) => c.currency), ["RWF", "USD"]);
  assertEquals(o.currencies[1].moneyOutMinor, 5n);
});

Deno.test("I1: net == in - out; I3: refund is not income", () => {
  const { facts, linked } = fixture();
  for (const c of computeOverview(facts, scope, linked).currencies) {
    assertEquals(c.netMinor, c.moneyInMinor - c.moneyOutMinor);
  }
  assertEquals(classify(facts[5], linked), "refund");
});

Deno.test("I5: drilldown rows reproduce every aggregate", () => {
  const { facts, linked } = fixture();
  const rwf = computeOverview(facts, scope, linked).currencies[0];
  const ids = (d: Parameters<typeof applyDrilldown>[1]) =>
    applyDrilldown(facts, d, linked).map((x) => x.id).sort();
  assertEquals(ids(rwf.drilldowns.money_in), ["salary"]);
  assertEquals(ids(rwf.drilldowns.transfers), ["tr_in", "tr_out"]);
  assertEquals(ids(rwf.drilldowns.pending), ["pend"]);
  assertEquals(ids(rwf.drilldowns.cash_out), ["atm"]);
  assertEquals(ids(rwf.drilldowns.refunds), ["refund"]);
  // money_out rows sum (signed: refunds subtract) equals moneyOut
  const rows = applyDrilldown(facts, rwf.drilldowns.money_out, linked);
  let sum = 0n;
  for (const r of rows) {
    const e = BigInt(r.principalEffectRwf + r.feeEffectRwf);
    sum += r.direction === "in" ? -e : -e;
  }
  assertEquals(sum, rwf.moneyOutMinor);
  for (const c of rwf.byCategory) {
    const rs = applyDrilldown(facts, c.drilldown, linked);
    let s = 0n;
    for (const r of rs) {
      const e = BigInt(r.principalEffectRwf + r.feeEffectRwf);
      s += -e; // out rows positive, refund rows negative
    }
    assertEquals(s, c.amountMinor, c.category);
  }
});

Deno.test("counterparties: same display name groups, sent/received split", () => {
  const { facts, linked } = fixture();
  const rwf = computeOverview(facts, scope, linked).currencies[0];
  const shop = rwf.counterparties.find((c) => c.key === "name:shop a")!;
  assertEquals(shop.sentMinor, 15100n); // food1 + food2 (+fees), refund not counted as received
  assertEquals(shop.receivedMinor, 0n);
});

Deno.test("account filter and inbound fees", () => {
  const facts = [
    f({
      id: "a",
      direction: "in",
      principalEffectRwf: 1000,
      feeEffectRwf: -20,
      transactionType: "money_received",
      category: null,
    }),
  ];
  const o = computeOverview(facts, { ...scope, accountIds: ["acc1"] }, none)
    .currencies[0];
  assertEquals(o.moneyInMinor, 1000n);
  assertEquals(o.moneyOutMinor, 20n); // inbound fee is outflow under "Fees"
  assertEquals(o.netMinor, 980n);
  assertEquals(
    computeOverview(facts, { ...scope, accountIds: ["other"] }, none).currencies
      .length,
    0,
  );
});

Deno.test("parity with report-math snapshot for plain settled facts", () => {
  const facts = [
    f({
      id: "i",
      direction: "in",
      principalEffectRwf: 9000,
      transactionType: "money_received",
    }),
    f({ id: "o1", principalEffectRwf: -2000, feeEffectRwf: -50 }),
    f({ id: "o2", principalEffectRwf: -1000 }),
  ];
  const snap = computeFinancialSnapshot(
    facts.map((x) => ({
      id: x.id,
      direction: x.direction,
      principalEffectRwf: x.principalEffectRwf,
      feeEffectRwf: x.feeEffectRwf,
      category: x.category,
      counterpartyName: x.counterpartyName,
      occurredAt: x.occurredAt,
    })),
    null,
    null,
  );
  const o = computeOverview(facts, scope, none).currencies[0];
  assertEquals(o.moneyInMinor, BigInt(snap.moneyReceivedRwf));
  assertEquals(o.moneyOutMinor, BigInt(snap.moneySpentRwf));
  assertEquals(o.netMinor, BigInt(snap.netMovementRwf));
});

Deno.test("compare: null history is not a fabricated zero", () => {
  assertEquals(compare(100n, null).deltaBps, null);
  assertEquals(compare(100n, 0n).deltaBps, null);
  assertEquals(compare(150n, 100n).deltaBps, 5000);
  assertEquals(compare(50n, 100n).deltaMinor, -50n);
});

Deno.test("trend: Kigali day boundary (UTC+2) and weekly/monthly buckets", () => {
  // 22:30Z on 31 Aug is 00:30 on 1 Sep in Kigali.
  const facts = [
    f({
      id: "a",
      occurredAt: "2026-08-31T22:30:00Z",
      principalEffectRwf: -100,
    }),
    f({
      id: "b",
      occurredAt: "2026-08-31T21:30:00Z",
      principalEffectRwf: -200,
    }),
  ];
  const wide = { from: "2026-08-01T00:00:00Z", to: "2026-10-01T00:00:00Z" };
  const day = computeTrend(facts, wide, "RWF", none, "day", "Africa/Kigali");
  assertEquals(day.map((d) => [d.bucketStart, d.moneyOutMinor]), [
    ["2026-08-31", 200n],
    ["2026-09-01", 100n],
  ]);
  const month = computeTrend(
    facts,
    wide,
    "RWF",
    none,
    "month",
    "Africa/Kigali",
  );
  assertEquals(month.map((d) => d.bucketStart), ["2026-08-01", "2026-09-01"]);
  const week = computeTrend(facts, wide, "RWF", none, "week", "Africa/Kigali");
  assertEquals(week.map((d) => [d.bucketStart, d.moneyOutMinor]), [[
    "2026-08-31",
    300n,
  ]]);
});

Deno.test("trend: DST zone (America/New_York spring forward 2026-03-08)", () => {
  const facts = [
    f({ id: "a", occurredAt: "2026-03-08T04:59:00Z", principalEffectRwf: -1 }), // 23:59 EST 7 Mar
    f({ id: "b", occurredAt: "2026-03-08T05:01:00Z", principalEffectRwf: -2 }), // 00:01 EST 8 Mar
    f({ id: "c", occurredAt: "2026-03-09T03:59:00Z", principalEffectRwf: -4 }), // 23:59 EDT 8 Mar
  ];
  const wide = { from: "2026-03-01T00:00:00Z", to: "2026-04-01T00:00:00Z" };
  const d = computeTrend(facts, wide, "RWF", none, "day", "America/New_York");
  assertEquals(d.map((x) => [x.bucketStart, x.moneyOutMinor]), [
    ["2026-03-07", 1n],
    ["2026-03-08", 6n],
  ]);
});

Deno.test("property: invariants hold on 300 seeded random datasets", () => {
  let seed = 12345;
  const rnd = () =>
    (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const types = [
    "merchant_payment",
    "send_money",
    "cash_withdrawal",
    "money_received",
    "refund",
  ];
  const cats = ["Food", "Rent", null, "Fun"];
  for (let run = 0; run < 300; run++) {
    const facts: InsightFact[] = [];
    const linked = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const t = types[Math.floor(rnd() * types.length)];
      const dir = t === "money_received" || t === "refund" ? "in" : "out";
      const amt = Math.floor(rnd() * 100000);
      const fee = Math.floor(rnd() * 500);
      const id = `r${run}-${i}`;
      if (rnd() < 0.15) linked.add(id);
      facts.push(f({
        id,
        direction: dir,
        transactionType: t,
        principalEffectRwf: dir === "in" ? amt : -amt,
        feeEffectRwf: -fee,
        category: cats[Math.floor(rnd() * cats.length)],
        settlement: rnd() < 0.1
          ? "pending"
          : rnd() < 0.05
          ? "failed"
          : "settled",
        counterpartyName: rnd() < 0.5 ? "A" : "B",
      }));
    }
    const o = computeOverview(facts, scope, linked).currencies[0];
    if (!o) continue;
    assertEquals(o.netMinor, o.moneyInMinor - o.moneyOutMinor);
    // categories partition money_out exactly
    assertEquals(
      o.byCategory.reduce((s, c) => s + c.amountMinor, 0n),
      o.moneyOutMinor,
    );
    // recompute is deterministic (I6)
    assertEquals(computeOverview(facts, scope, linked).currencies[0], o);
    // linked/pending/failed rows never reach totals
    const counted = applyDrilldown(facts, o.drilldowns.money_in, linked)
      .concat(applyDrilldown(facts, o.drilldowns.money_out, linked));
    for (const r of counted) {
      assertEquals(
        ["income", "spend", "cash_out", "refund"].includes(classify(r, linked)),
        true,
      );
    }
  }
});

Deno.test("rejects non-integer money (no floats)", () => {
  let threw = false;
  try {
    computeOverview([f({ principalEffectRwf: -10.5 })], scope, none);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
