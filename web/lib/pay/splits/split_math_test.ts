import { assertEquals } from "jsr:@std/assert@1";
import {
  type FeeBand,
  type SavingOptions,
  bandsAreValid,
  DEFAULT_SAVING_OPTIONS,
  partsSumTo,
  planCapacitySplit,
  planFeeSavingSplit,
  THRESHOLD_MIN_SAVING_PER_EXTRA_PART,
} from "./split-math.ts";

// A TEST FIXTURE. These are MTN Rwanda's published MTN-to-MTN person-to-person fees
// (https://www.mtn.co.rw/momo-tarrif/, "P2P On-net", retrieved 2026-11-24), the same
// bands as the verified tariff in migration 20270126000000. Production reads the
// verified provider_tariffs rows, not this constant.
const FIXTURE_BANDS: FeeBand[] = [
  { fromMinor: 1n, toMinor: 1_000n, feeMinor: 20n },
  { fromMinor: 1_001n, toMinor: 10_000n, feeMinor: 100n },
  { fromMinor: 10_001n, toMinor: 150_000n, feeMinor: 250n },
  { fromMinor: 150_001n, toMinor: 2_000_000n, feeMinor: 1_500n },
  { fromMinor: 2_000_001n, toMinor: 5_000_000n, feeMinor: 3_000n },
  { fromMinor: 5_000_001n, toMinor: 10_000_000n, feeMinor: 5_000n },
];

const ANY: SavingOptions = { ...DEFAULT_SAVING_OPTIONS, minSavingsPerExtraPartMinor: 0n };

function sum(parts: { amountMinor: bigint }[]): bigint {
  return parts.reduce((s, p) => s + p.amountMinor, 0n);
}

// ------------------------------ capacity split ----------------------------

Deno.test("capacity: at or below capacity nothing is suggested", () => {
  for (const v of [1n, 9_999_999n, 10_000_000n]) {
    assertEquals(planCapacitySplit({ totalMinor: v, capacityMinor: 10_000_000n }).status, "fits");
  }
});

Deno.test("capacity: one unit over capacity splits evenly into two", () => {
  const r = planCapacitySplit({
    totalMinor: 10_000_001n,
    capacityMinor: 10_000_000n,
    feePerPartMinor: 20n,
  });
  if (r.status !== "plan") throw new Error("expected a plan");
  assertEquals(r.parts.map((p) => p.amountMinor), [5_000_001n, 5_000_000n]);
  assertEquals(r.feeCeilingMinor, 40n);
  assertEquals(partsSumTo(r.parts, 10_000_001n), true);
});

Deno.test("capacity: 25M is three parts, none above capacity, largest first", () => {
  const r = planCapacitySplit({ totalMinor: 25_000_000n, capacityMinor: 10_000_000n });
  if (r.status !== "plan") throw new Error("expected a plan");
  assertEquals(r.parts.length, 3);
  assertEquals(r.feeCeilingMinor, null);
  for (let i = 0; i < r.parts.length; i++) {
    if (r.parts[i].amountMinor > 10_000_000n) throw new Error("part over capacity");
    if (i > 0 && r.parts[i].amountMinor > r.parts[i - 1].amountMinor) throw new Error("not largest first");
  }
  assertEquals(sum(r.parts), 25_000_000n);
});

Deno.test("capacity: exact multiple uses full-capacity parts", () => {
  const r = planCapacitySplit({ totalMinor: 30_000_000n, capacityMinor: 10_000_000n });
  if (r.status !== "plan") throw new Error("expected a plan");
  assertEquals(r.parts.map((p) => p.amountMinor), [10_000_000n, 10_000_000n, 10_000_000n]);
});

Deno.test("capacity: refuses an absurd number of parts and bad input", () => {
  assertEquals(
    planCapacitySplit({ totalMinor: 500_000_000n, capacityMinor: 10_000_000n, maxParts: 10 }),
    { status: "too_many_parts", partsNeeded: 50 },
  );
  assertEquals(planCapacitySplit({ totalMinor: 0n, capacityMinor: 10_000_000n }).status, "invalid_input");
  assertEquals(planCapacitySplit({ totalMinor: 5n, capacityMinor: 0n }).status, "invalid_input");
});

Deno.test("capacity: every plan's parts add back up and each fits", () => {
  for (let total = 10_000_001n; total < 10_000_001n + 300n; total++) {
    const r = planCapacitySplit({ totalMinor: total, capacityMinor: 10_000_000n });
    if (r.status !== "plan") throw new Error("expected a plan");
    assertEquals(partsSumTo(r.parts, total), true);
    for (const p of r.parts) if (p.amountMinor > 10_000_000n) throw new Error("part over capacity");
  }
});

// ------------------------------ fee-saving split --------------------------

Deno.test("fee-saving: the Save On example, 180,000 = 150,000 + 30,000", () => {
  const r = planFeeSavingSplit(FIXTURE_BANDS, 180_000n, DEFAULT_SAVING_OPTIONS);
  if (r.status !== "plan") throw new Error("expected a plan");
  assertEquals(r.singleFeeMinor, 1_500n);
  assertEquals(r.plannedFeeMinor, 500n);
  assertEquals(r.savingsMinor, 1_000n);
  assertEquals(r.parts.map((p) => p.amountMinor), [150_000n, 30_000n]);
});

Deno.test("fee-saving: nothing in the cheapest band or beyond the bands", () => {
  assertEquals(planFeeSavingSplit(FIXTURE_BANDS, 500n, ANY).status, "none");
  assertEquals(planFeeSavingSplit(FIXTURE_BANDS, 1_000n, ANY).status, "none");
  const over = planFeeSavingSplit(FIXTURE_BANDS, 10_000_001n, ANY);
  assertEquals(over, { status: "none", reason: "amount_outside_bands" });
});

Deno.test("fee-saving: thresholds gate the offer", () => {
  // 10,500 costs 250 as one; 10,000 + 500 costs 120: saves 130 (enough for Worth It's 100,
  // not for Big Wins' 500).
  const balanced = planFeeSavingSplit(FIXTURE_BANDS, 10_500n, DEFAULT_SAVING_OPTIONS);
  if (balanced.status !== "plan") throw new Error("expected a plan");
  assertEquals(balanced.savingsMinor, 130n);
  const bigger = planFeeSavingSplit(FIXTURE_BANDS, 10_500n, {
    ...DEFAULT_SAVING_OPTIONS,
    minSavingsPerExtraPartMinor: THRESHOLD_MIN_SAVING_PER_EXTRA_PART.bigger,
  });
  assertEquals(bigger, { status: "none", reason: "threshold_not_met" });
});

Deno.test("fee-saving: a larger minimum part changes or removes the offer", () => {
  const r = planFeeSavingSplit(FIXTURE_BANDS, 180_000n, { ...ANY, minPartMinor: 1_001n });
  if (r.status !== "plan") throw new Error("expected a plan");
  for (const p of r.parts) if (p.amountMinor < 1_001n) throw new Error("part below minimum");
  assertEquals(partsSumTo(r.parts, 180_000n), true);
  const none = planFeeSavingSplit(FIXTURE_BANDS, 180_000n, { ...ANY, minPartMinor: 100_000n });
  assertEquals(none.status, "none");
});

Deno.test("fee-saving: matches an independent brute-force minimum for every amount", () => {
  const small: FeeBand[] = [
    { fromMinor: 1n, toMinor: 10n, feeMinor: 2n },
    { fromMinor: 11n, toMinor: 40n, feeMinor: 7n },
    { fromMinor: 41n, toMinor: 90n, feeMinor: 12n },
    { fromMinor: 91n, toMinor: 200n, feeMinor: 31n },
  ];
  const feeOf = (a: number): number | null => {
    const b = small.find((x) => a >= Number(x.fromMinor) && a <= Number(x.toMinor!));
    return b ? Number(b.feeMinor) : null;
  };
  const maxParts = 4;
  // best[k][a] = lowest fee to send exactly `a` in exactly k parts.
  const INF = Number.POSITIVE_INFINITY;
  const N = 200;
  const best: number[][] = Array.from({ length: maxParts + 1 }, () => Array(N + 1).fill(INF));
  best[0][0] = 0;
  for (let k = 1; k <= maxParts; k++) {
    for (let a = 1; a <= N; a++) {
      for (let p = 1; p <= a; p++) {
        const f = feeOf(p);
        if (f === null || best[k - 1][a - p] === INF) continue;
        best[k][a] = Math.min(best[k][a], best[k - 1][a - p] + f);
      }
    }
  }
  const opts: SavingOptions = {
    maxParts,
    minTotalSavingsMinor: 0n,
    minSavingsPerExtraPartMinor: 0n,
    minPartMinor: 1n,
  };
  for (let a = 1; a <= N; a++) {
    const single = feeOf(a)!;
    let ref = INF;
    for (let k = 2; k <= maxParts; k++) ref = Math.min(ref, best[k][a]);
    const r = planFeeSavingSplit(small, BigInt(a), opts);
    if (ref < single) {
      if (r.status !== "plan") throw new Error(`amount ${a}: expected a plan`);
      assertEquals(Number(r.plannedFeeMinor), ref, `amount ${a}`);
      assertEquals(partsSumTo(r.parts, BigInt(a)), true, `amount ${a} sums`);
      for (const p of r.parts) {
        assertEquals(Number(p.feeMinor), feeOf(Number(p.amountMinor)), `amount ${a} part fee`);
      }
    } else {
      assertEquals(r.status, "none", `amount ${a}`);
    }
  }
});

Deno.test("fee-saving: refuses bad band sets", () => {
  assertEquals(bandsAreValid([]), false);
  assertEquals(
    bandsAreValid([
      { fromMinor: 1n, toMinor: 100n, feeMinor: 1n },
      { fromMinor: 50n, toMinor: 200n, feeMinor: 2n },
    ]),
    false,
  );
  assertEquals(
    planFeeSavingSplit([{ fromMinor: 5n, toMinor: 1n, feeMinor: 1n }], 10n, ANY),
    { status: "none", reason: "invalid_bands" },
  );
  assertEquals(bandsAreValid(FIXTURE_BANDS), true);
});
