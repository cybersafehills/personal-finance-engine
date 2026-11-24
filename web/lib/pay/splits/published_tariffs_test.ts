import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  bandsAreValid,
  DEFAULT_SAVING_OPTIONS,
  type FeeBand,
  planCapacitySplit,
  planFeeSavingSplit,
  THRESHOLD_MIN_SAVING_PER_EXTRA_PART,
} from "./split-math.ts";
import { feeForAmount } from "./rules.ts";
import SQL from "../../../../supabase/migrations/20270126000000_save_on_published_tariffs.sql" with { type: "text" };

// Save On is only as right as the fee tables behind it. These tests read the real
// tariff migration (generated from MTN's and Airtel's own fee pages) and run the
// split logic on it, so a wrong or mistyped band fails here.

/** The bands of one `-- <provider> / <type> / <scope>:` block. */
function bandsOf(header: string): FeeBand[] {
  const start = SQL.indexOf(`-- ${header}`);
  assert(start >= 0, `missing block: ${header}`);
  const next = SQL.indexOf("\n-- ", start + 5);
  const block = SQL.slice(start, next < 0 ? undefined : next);
  const out: FeeBand[] = [];
  for (const m of block.matchAll(/\((\d+)::bigint, (\d+)::bigint, 'fixed', (\d+)::bigint\)/g)) {
    out.push({ fromMinor: BigInt(m[1]), toMinor: BigInt(m[2]), feeMinor: BigInt(m[3]) });
  }
  return out;
}

const mtnP2p = bandsOf("mtn-rwanda / send_money / same_network");
const mtnEkash = bandsOf("mtn-rwanda / bank_transfer / any");
const OPTS = (threshold: keyof typeof THRESHOLD_MIN_SAVING_PER_EXTRA_PART) => ({
  ...DEFAULT_SAVING_OPTIONS,
  minSavingsPerExtraPartMinor: THRESHOLD_MIN_SAVING_PER_EXTRA_PART[threshold],
});

Deno.test("MTN person-to-person bands are the published six, valid, and end at RWF 10,000,000", () => {
  assertEquals(mtnP2p.length, 6);
  assert(bandsAreValid(mtnP2p));
  assertEquals(mtnP2p.map((b) => b.feeMinor), [20n, 100n, 250n, 1500n, 3000n, 5000n]);
  assertEquals(mtnP2p[5].toMinor, 10_000_000n);
  assertEquals(feeForAmount(mtnP2p, 150_000n), 250n);
  assertEquals(feeForAmount(mtnP2p, 150_001n), 1500n);
  assertEquals(feeForAmount(mtnP2p, 10_000_001n), null); // outside the published bands: no number
});

Deno.test("MTN eKash route is a flat RWF 20 in every band up to RWF 10,000,000", () => {
  assertEquals(mtnEkash.length, 6);
  assert(bandsAreValid(mtnEkash));
  assert(mtnEkash.every((b) => b.feeMinor === 20n));
  assertEquals(feeForAmount(mtnEkash, 10_000_000n), 20n);
  assertEquals(feeForAmount(mtnEkash, 10_000_001n), null);
});

Deno.test("180,000 to an MTN number: 150,000 + 30,000 costs 500 instead of 1,500", () => {
  const r = planFeeSavingSplit(mtnP2p, 180_000n, OPTS("balanced"));
  assertEquals(r.status, "plan");
  if (r.status !== "plan") return;
  assertEquals(r.parts.map((p) => p.amountMinor), [150_000n, 30_000n]);
  assertEquals(r.singleFeeMinor, 1500n);
  assertEquals(r.plannedFeeMinor, 500n);
  assertEquals(r.savingsMinor, 1000n);
});

Deno.test("an amount already in a cheap band is not split", () => {
  for (const a of [10_000n, 150_000n, 3_000_000n]) {
    assertEquals(planFeeSavingSplit(mtnP2p, a, OPTS("any")).status, "none");
  }
});

Deno.test("the Save On level decides whether a saving is worth a split", () => {
  // 1,500 as one transfer is 100; as 1,000 + 500 it is 40: a saving of 60. Only
  // "Every Franc" suggests it; "Worth It" (needs 100) and "Big Wins" (500) do not.
  assertEquals(planFeeSavingSplit(mtnP2p, 1_500n, OPTS("any")).status, "plan");
  assertEquals(planFeeSavingSplit(mtnP2p, 1_500n, OPTS("balanced")).status, "none");
  assertEquals(planFeeSavingSplit(mtnP2p, 1_500n, OPTS("bigger")).status, "none");
  // 10,500 saves 130: enough for "Worth It", not for "Big Wins".
  assertEquals(planFeeSavingSplit(mtnP2p, 10_500n, OPTS("balanced")).status, "plan");
  assertEquals(planFeeSavingSplit(mtnP2p, 10_500n, OPTS("bigger")).status, "none");
  // 180,000 saves 1,000: every level suggests it.
  for (const level of ["any", "balanced", "bigger"] as const) {
    assertEquals(planFeeSavingSplit(mtnP2p, 180_000n, OPTS(level)).status, "plan");
  }
});

import { messages } from "../../ussd/messages.ts";
import { THRESHOLD_MIN_SAVING_PER_EXTRA_PART as MINS } from "./split-math.ts";

Deno.test("the figures and the example in the Save On copy match what the code uses", () => {
  const s = messages().pay.splits.settings;
  assert(s.balancedHint.includes(`${MINS.balanced} RWF`));
  assert(s.biggerHint.includes(`${MINS.bigger} RWF`));
  // The example paragraph is true to MTN's table: 180,000 costs 1,500 as one, 500 as 150,000 + 30,000.
  const r = planFeeSavingSplit(mtnP2p, 180_000n, OPTS("any"));
  assertEquals(r.status, "plan");
  if (r.status !== "plan") return;
  assert(s.example.includes("180,000") && s.example.includes("1,500") && s.example.includes("500 RWF"));
  assertEquals([r.singleFeeMinor, r.plannedFeeMinor], [1500n, 500n]);
});

Deno.test("an eKash amount above RWF 10,000,000 splits into parts that each cost RWF 20", () => {
  const plan = planCapacitySplit({ totalMinor: 25_000_000n, capacityMinor: 10_000_000n });
  assertEquals(plan.status, "plan");
  if (plan.status !== "plan") return;
  const fees = plan.parts.map((p) => feeForAmount(mtnEkash, p.amountMinor));
  assertEquals(fees, [20n, 20n, 20n]);
  // Parts never save fees on this route (a flat fee per transfer): only capacity forces them.
  assertEquals(planCapacitySplit({ totalMinor: 10_000_000n, capacityMinor: 10_000_000n }).status, "fits");
});

Deno.test("Airtel: no person-to-person tariff is loaded, so it never gets a fee-saving offer", () => {
  assert(!/airtel-rwanda'?\s*\/\s*send_money/.test(SQL));
  assert(!/slug = 'airtel-rwanda'\)[\s\S]{0,200}'send_money'/.test(SQL));
  assertEquals(bandsOf("airtel-rwanda / cash_withdrawal / any").length, 14);
  const w2b = bandsOf("airtel-rwanda / bank_transfer / any");
  assertEquals(w2b.length, 13);
  assertEquals(w2b[0].fromMinor, 101n); // the page lists no band below 101: no number is invented
  assert(bandsAreValid(w2b));
});

Deno.test("every loaded tariff cites an https source and is verified at the end", () => {
  assertEquals((SQL.match(/'https:\/\/(www\.mtn\.co\.rw\/momo-tarrif\/|airtelmoney\.rw\/transaction_fees)'/g) ?? []).length, 5);
  assert(/update public\.provider_tariffs set verified_at = now\(\)/.test(SQL));
});
