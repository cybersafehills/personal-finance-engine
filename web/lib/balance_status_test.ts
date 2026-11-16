import { assertEquals } from "jsr:@std/assert@1";
import { type BalanceBaselineRow, deriveBalance } from "./balance-status.ts";

const NOW = new Date("2026-11-15T12:00:00Z");
const row = (o: Partial<BalanceBaselineRow> = {}): BalanceBaselineRow => ({
  baseline_amount_minor: "100000",
  baseline_as_of: "2026-11-14T12:00:00Z",
  baseline_source: "provider_reported",
  txns_since_count: 0,
  net_effect_since_minor: 0,
  unresolved_since_count: 0,
  mismatch_since_count: 0,
  ...o,
});

Deno.test("no baseline -> unavailable, no number", () => {
  const d = deriveBalance(
    row({
      baseline_amount_minor: null,
      baseline_as_of: null,
      baseline_source: null,
    }),
    NOW,
  );
  assertEquals(d.status, "unavailable");
  assertEquals(d.amountMinor, null);
  assertEquals(d.asOf, null);
});

Deno.test("fresh provider baseline, nothing since -> confirmed", () => {
  const d = deriveBalance(row(), NOW);
  assertEquals([d.status, d.amountMinor], ["confirmed", 100000n]);
});

Deno.test("provider baseline + clean later activity -> estimated = baseline + net", () => {
  const d = deriveBalance(
    row({ txns_since_count: 2, net_effect_since_minor: -2500 }),
    NOW,
  );
  assertEquals([d.status, d.amountMinor], ["estimated", 97500n]);
  assertEquals(d.asOf, "2026-11-14T12:00:00Z"); // as-of is the baseline, not now
});

Deno.test("older than threshold -> stale, shows last KNOWN balance not a projection", () => {
  const d = deriveBalance(
    row({
      baseline_as_of: "2026-11-01T00:00:00Z",
      txns_since_count: 3,
      net_effect_since_minor: -9999,
    }),
    NOW,
  );
  assertEquals([d.status, d.amountMinor], ["stale", 100000n]);
  assertEquals(d.reasons, ["baseline_old"]);
});

Deno.test("exactly at threshold is not yet stale; one ms over is", () => {
  const edge = new Date(NOW.getTime() - 7 * 86400000).toISOString();
  assertEquals(
    deriveBalance(row({ baseline_as_of: edge }), NOW).status,
    "confirmed",
  );
  const over = new Date(NOW.getTime() - 7 * 86400000 - 1).toISOString();
  assertEquals(
    deriveBalance(row({ baseline_as_of: over }), NOW).status,
    "stale",
  );
});

Deno.test("unresolved (pending/unclassified) activity blocks an estimate", () => {
  const d = deriveBalance(
    row({
      txns_since_count: 1,
      net_effect_since_minor: -500,
      unresolved_since_count: 1,
    }),
    NOW,
  );
  assertEquals([d.status, d.amountMinor], ["stale", 100000n]);
  assertEquals(d.reasons, ["unresolved_activity"]);
});

Deno.test("reconciliation mismatch since baseline (missing SMS/gap) -> stale", () => {
  const d = deriveBalance(
    row({ txns_since_count: 1, mismatch_since_count: 1 }),
    NOW,
  );
  assertEquals(d.status, "stale");
  assertEquals(d.reasons, ["reconciliation_mismatch"]);
});

Deno.test("manual baseline is never 'confirmed'", () => {
  const none = deriveBalance(row({ baseline_source: "manual" }), NOW);
  assertEquals([none.status, none.basis, none.amountMinor], [
    "estimated",
    "manual",
    100000n,
  ]);
  const some = deriveBalance(
    row({
      baseline_source: "manual",
      txns_since_count: 1,
      net_effect_since_minor: 400,
    }),
    NOW,
  );
  assertEquals([some.status, some.amountMinor], ["estimated", 100400n]);
});

Deno.test("accepts string/bigint numerics (PostgREST bigint) and negative balances", () => {
  const d = deriveBalance(
    row({
      baseline_amount_minor: -5000n,
      txns_since_count: "1",
      net_effect_since_minor: "-100",
    }),
    NOW,
  );
  assertEquals([d.status, d.amountMinor], ["estimated", -5100n]);
});

Deno.test("custom threshold respected", () => {
  assertEquals(deriveBalance(row(), NOW, 60 * 60 * 1000).status, "stale");
});
