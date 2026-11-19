import { assertEquals } from "jsr:@std/assert@1";
import {
  estimateFromHistory,
  estimatePublishedFee,
  type FeeSchedule,
  type HistorySample,
  inEffect,
  limitWarnings,
  type LimitRow,
  parseFeeAmount,
  parseFeeQuery,
  pickSchedule,
} from "./fee-estimate.ts";

const NOW = new Date("2026-11-18T10:00:00Z");

function fee(p: Partial<FeeSchedule> & { fee_type: string }): FeeSchedule {
  return {
    fixed_fee_minor: null,
    percentage_bps: null,
    min_fee_minor: null,
    max_fee_minor: null,
    currency: "RWF",
    effective_from: "2026-01-01T00:00:00Z",
    effective_to: null,
    source_url: null,
    source_label: "RSwitch",
    note_en: null,
    ...p,
  };
}

Deno.test("published: fixed, none, and a published maximum (upper bound only)", () => {
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "fixed", fixed_fee_minor: 150 }), 5000n, "RWF", NOW),
    { status: "exact", feeMinor: 150n },
  );
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "none" }), 5000n, "RWF", NOW),
    { status: "exact", feeMinor: 0n },
  );
  // The seeded eKash row: "at most RWF 20" is a ceiling, never a prediction.
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "published_maximum", max_fee_minor: 20 }), 5000n, "RWF", NOW),
    { status: "upper_bound", maxMinor: 20n },
  );
});

Deno.test("published: tiered / unknown / varies give NO number", () => {
  for (const t of ["tiered", "unknown", "varies_by_institution"] as const) {
    assertEquals(
      estimatePublishedFee(fee({ fee_type: t }), 5000n, "RWF", NOW),
      { status: "not_computable", reason: t },
    );
  }
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "mystery" }), 5000n, "RWF", NOW),
    { status: "not_computable", reason: "unrecognised" },
  );
  // Missing the amount the type needs: incomplete, not zero.
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "fixed" }), 5000n, "RWF", NOW),
    { status: "not_computable", reason: "incomplete" },
  );
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "published_maximum" }), 5000n, "RWF", NOW),
    { status: "not_computable", reason: "incomplete" },
  );
});

Deno.test("published: percentage uses exact integer maths, with floor..ceiling and clamps", () => {
  // 0.5% (50 bps) of 10,000 = 50 exactly.
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "percentage", percentage_bps: 50 }), 10000n, "RWF", NOW),
    { status: "exact", feeMinor: 50n },
  );
  // 0.5% of 10,001 = 50.005 -> whole units 50..51, not a rounded guess.
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "percentage", percentage_bps: 50 }), 10001n, "RWF", NOW),
    { status: "range", minMinor: 50n, maxMinor: 51n },
  );
  // Clamped to the published minimum and maximum.
  const p = { fee_type: "percentage", percentage_bps: 100, min_fee_minor: 100, max_fee_minor: 500 };
  assertEquals(estimatePublishedFee(fee(p), 1000n, "RWF", NOW), { status: "exact", feeMinor: 100n });
  assertEquals(estimatePublishedFee(fee(p), 1_000_000n, "RWF", NOW), { status: "exact", feeMinor: 500n });
  assertEquals(estimatePublishedFee(fee(p), 30000n, "RWF", NOW), { status: "exact", feeMinor: 300n });
  // Exact beyond 2^53: no float anywhere.
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "percentage", percentage_bps: 1 }), 12345678901234567890n, "RWF", NOW),
    { status: "range", minMinor: 1234567890123456n, maxMinor: 1234567890123457n },
  );
});

Deno.test("published: validity window and currency are respected", () => {
  assertEquals(
    estimatePublishedFee(
      fee({ fee_type: "fixed", fixed_fee_minor: 100, effective_to: "2026-06-01T00:00:00Z" }),
      5000n, "RWF", NOW,
    ),
    { status: "not_in_effect", reason: "expired" },
  );
  assertEquals(
    estimatePublishedFee(
      fee({ fee_type: "fixed", fixed_fee_minor: 100, effective_from: "2027-01-01T00:00:00Z" }),
      5000n, "RWF", NOW,
    ),
    { status: "not_in_effect", reason: "not_yet" },
  );
  assertEquals(
    estimatePublishedFee(fee({ fee_type: "fixed", fixed_fee_minor: 100 }), 5000n, "USD", NOW),
    { status: "not_computable", reason: "currency_mismatch" },
  );
  // effective_to is exclusive, effective_from inclusive.
  assertEquals(inEffect({ effective_from: NOW.toISOString(), effective_to: null }, NOW), "yes");
  assertEquals(inEffect({ effective_from: null, effective_to: NOW.toISOString() }, NOW), "expired");
});

Deno.test("pickSchedule: newest in-effect row wins; otherwise says why nothing applies", () => {
  const old = fee({ fee_type: "fixed", fixed_fee_minor: 100, effective_from: "2025-01-01T00:00:00Z", effective_to: "2026-03-01T00:00:00Z" });
  const cur = fee({ fee_type: "fixed", fixed_fee_minor: 120, effective_from: "2026-03-01T00:00:00Z" });
  const next = fee({ fee_type: "fixed", fixed_fee_minor: 150, effective_from: "2027-01-01T00:00:00Z" });
  assertEquals(pickSchedule([old, next, cur], NOW)?.schedule, cur);
  assertEquals(pickSchedule([old, next], NOW)?.state, "expired");
  assertEquals(pickSchedule([next], NOW)?.state, "not_yet");
  assertEquals(pickSchedule([], NOW), null);
});

function lim(p: Partial<LimitRow>): LimitRow {
  return {
    min_txn_minor: null, max_txn_minor: null, daily_limit_minor: null, currency: "RWF",
    is_published_maximum: false, effective_from: "2026-01-01T00:00:00Z", effective_to: null,
    source_label: null, ...p,
  };
}

Deno.test("limits: warns, never proposes splitting", () => {
  const w = limitWarnings(
    [lim({ min_txn_minor: 100, max_txn_minor: 10_000_000, is_published_maximum: true, daily_limit_minor: 20_000_000 })],
    25_000_000n, "RWF", NOW,
  );
  assertEquals(w.map((x) => x.kind), ["above_maximum", "above_daily"]);
  assertEquals(w[0].publishedMaximum, true);
  assertEquals(limitWarnings([lim({ min_txn_minor: 100 })], 50n, "RWF", NOW).map((x) => x.kind), ["below_minimum"]);
  // Inside the limits, other currency, or not in effect: nothing.
  assertEquals(limitWarnings([lim({ max_txn_minor: 10_000_000 })], 5000n, "RWF", NOW), []);
  assertEquals(limitWarnings([lim({ max_txn_minor: 10 })], 5000n, "USD", NOW), []);
  assertEquals(limitWarnings([lim({ max_txn_minor: 10, effective_to: "2026-02-01T00:00:00Z" })], 5000n, "RWF", NOW), []);
  // The warning carries no alternative amounts.
  for (const x of w) assertEquals(Object.keys(x).sort(), ["kind", "limitMinor", "publishedMaximum"]);
});

function s(amount: number, f: number, at: string): HistorySample {
  return { amountMinor: BigInt(amount), feeMinor: BigInt(f), at };
}

Deno.test("history: similar = within +-20%, needs 3, reports the observed range", () => {
  const samples = [
    s(5000, 100, "2026-11-10T10:00:00Z"),
    s(5200, 100, "2026-10-10T10:00:00Z"),
    s(4800, 100, "2026-09-10T10:00:00Z"),
    s(4000, 100, "2026-08-10T10:00:00Z"), // exactly -20%: included
    s(6000, 100, "2026-07-10T10:00:00Z"), // exactly +20%: included
    s(6001, 999, "2026-06-10T10:00:00Z"), // just outside
    s(3999, 999, "2026-05-10T10:00:00Z"), // just outside
    s(50000, 500, "2026-04-10T10:00:00Z"),
  ];
  const e = estimateFromHistory(samples, 5000n);
  if (e.status !== "estimate") throw new Error("expected an estimate");
  assertEquals([e.minMinor, e.maxMinor, e.typicalMinor, e.count], [100n, 100n, 100n, 5]);
  assertEquals([e.windowLowMinor, e.windowHighMinor], [4000n, 6000n]);
  assertEquals(e.lastAt, "2026-11-10T10:00:00Z");
  assertEquals(e.firstAt, "2026-07-10T10:00:00Z");
  assertEquals(e.recent.length, 5);
  assertEquals(e.recent[0].at, "2026-11-10T10:00:00Z"); // newest first
});

Deno.test("history: mixed fees give a range, and no 'usual' fee below 60%", () => {
  const e = estimateFromHistory(
    [s(5000, 100, "2026-11-01T00:00:00Z"), s(5000, 100, "2026-10-01T00:00:00Z"), s(5000, 200, "2026-09-01T00:00:00Z")],
    5000n,
  );
  if (e.status !== "estimate") throw new Error("expected an estimate");
  assertEquals([e.minMinor, e.maxMinor], [100n, 200n]);
  // 2 of 3 = 66.6% >= 60%: 100 is the usual fee.
  assertEquals(e.typicalMinor, 100n);
  const split = estimateFromHistory(
    [s(5000, 100, "2026-11-01T00:00:00Z"), s(5000, 200, "2026-10-01T00:00:00Z"), s(5000, 300, "2026-09-01T00:00:00Z")],
    5000n,
  );
  if (split.status !== "estimate") throw new Error("expected an estimate");
  assertEquals(split.typicalMinor, null);
});

Deno.test("history: too little evidence is said plainly, never padded", () => {
  assertEquals(estimateFromHistory([], 5000n), { status: "no_history" });
  assertEquals(
    estimateFromHistory([s(5000, 100, "2026-11-01T00:00:00Z"), s(5100, 100, "2026-10-01T00:00:00Z"), s(90000, 900, "2026-09-01T00:00:00Z")], 5000n),
    { status: "not_enough_history", similarCount: 2, totalCount: 3 },
  );
});

Deno.test("history: ties on the usual fee go to the larger one (never understate)", () => {
  const e = estimateFromHistory(
    [s(5000, 100, "2026-11-01T00:00:00Z"), s(5000, 100, "2026-10-01T00:00:00Z"), s(5000, 200, "2026-09-01T00:00:00Z"), s(5000, 200, "2026-08-01T00:00:00Z")],
    5000n,
  );
  if (e.status !== "estimate") throw new Error("expected an estimate");
  // 2/4 = 50% < 60%: no usual fee; the range still shows both.
  assertEquals([e.minMinor, e.maxMinor, e.typicalMinor], [100n, 200n, null]);
});

Deno.test("amount parsing: exact, never rounds, refuses nonsense", () => {
  assertEquals(parseFeeAmount("25,000", "RWF"), { ok: true, minor: 25000n });
  assertEquals(parseFeeAmount(" 25 000.00 ", "RWF"), { ok: true, minor: 25000n });
  assertEquals(parseFeeAmount("12.34", "USD"), { ok: true, minor: 1234n });
  assertEquals(parseFeeAmount("12.5", "EUR"), { ok: true, minor: 1250n });
  for (const [t, c] of [["12.345", "USD"], ["100.5", "RWF"], ["0", "RWF"], ["0.00", "USD"], ["-5", "RWF"], ["", "RWF"], ["abc", "RWF"], ["1e3", "RWF"]]) {
    assertEquals(parseFeeAmount(t, c).ok, false, `${t} ${c}`);
  }
  assertEquals(parseFeeAmount("100", "KES"), { ok: false, error: "Fees in KES can't be estimated yet." });
  assertEquals(parseFeeAmount("999999999999999", "RWF").ok, true);
  assertEquals(parseFeeAmount("1000000000000000", "RWF").ok, false);
  assertEquals(parseFeeAmount("9999999999999.99", "USD").ok, true);
  assertEquals(parseFeeAmount("99999999999999.99", "USD").ok, false);
});

Deno.test("query: hostile input degrades to safe defaults", () => {
  const q = parseFeeQuery(
    { amount: "5,000", currency: "usd", type: "send_money", network: "ekash", workspace_id: "not-a-uuid" },
    "RWF",
  );
  assertEquals([q.currency, q.amountMinor, q.type, q.network, q.workspaceId], ["USD", 500000n, "send_money", "ekash", null]);

  const bad = parseFeeQuery(
    { amount: "'; drop table", currency: "RWF1", type: "../../etc", network: "NOT a slug!", workspace_id: ["x"] },
    "RWF",
  );
  assertEquals([bad.currency, bad.amountMinor, bad.type, bad.network], ["RWF", null, "send_money", null]);
  assertEquals(bad.amountError, "Enter a whole amount, like 25,000.");

  const empty = parseFeeQuery({}, "RWF");
  assertEquals([empty.amountText, empty.amountMinor, empty.amountError], ["", null, null]);
  assertEquals(
    parseFeeQuery({ workspace_id: "11111111-1111-4111-8111-111111111111" }, "RWF").workspaceId,
    "11111111-1111-4111-8111-111111111111",
  );
});

import { buildFeeResult, FEE_DISCLAIMER, serializeFeeResult } from "./fee-result.ts";

Deno.test("result: history and published schedule are reported separately, never blended", () => {
  const r = buildFeeResult({
    amountMinor: 5000n,
    currency: "RWF",
    type: "send_money",
    history: {
      samples: [s(5000, 100, "2026-11-01T00:00:00Z"), s(5100, 100, "2026-10-01T00:00:00Z"), s(4900, 100, "2026-09-01T00:00:00Z")],
      capped: false,
    },
    network: {
      slug: "ekash",
      name: "eKash",
      fees: [fee({ fee_type: "published_maximum", max_fee_minor: 20 })],
      limits: [lim({ max_txn_minor: 10_000_000, is_published_maximum: true })],
    },
    now: NOW,
  });
  assertEquals(r.history.status, "estimate");
  assertEquals(r.published?.estimate, { status: "upper_bound", maxMinor: 20n });
  assertEquals(r.published?.warnings, []);
  const j = serializeFeeResult(r);
  assertEquals(j.amount_minor, "5000");
  assertEquals(j.published?.estimate, { status: "upper_bound", max_minor: "20" });
  assertEquals(j.history.status, "estimate");
  assertEquals(j.disclaimer, FEE_DISCLAIMER);
  // JSON-safe: no bigint survives serialisation.
  JSON.stringify(j);
});

Deno.test("result: a network with no fee row says so; no network means no published section", () => {
  const none = buildFeeResult({
    amountMinor: 5000n, currency: "RWF", type: "send_money",
    history: { samples: [], capped: false },
    network: { slug: "x", name: "X", fees: [], limits: [] },
    now: NOW,
  });
  assertEquals([none.published?.hasSchedule, none.published?.estimate], [false, null]);
  assertEquals(none.history, { status: "no_history" });
  const bare = buildFeeResult({
    amountMinor: 5000n, currency: "RWF", type: "send_money",
    history: { samples: [], capped: false }, network: null, now: NOW,
  });
  assertEquals(bare.published, null);
  assertEquals(serializeFeeResult(bare).published, null);
});

Deno.test("result: an amount above the published maximum warns and offers nothing else", () => {
  const r = buildFeeResult({
    amountMinor: 20_000_000n, currency: "RWF", type: "send_money",
    history: { samples: [], capped: false },
    network: { slug: "ekash", name: "eKash", fees: [fee({ fee_type: "published_maximum", max_fee_minor: 20 })], limits: [lim({ max_txn_minor: 10_000_000, is_published_maximum: true })] },
    now: NOW,
  });
  assertEquals(r.published?.warnings.map((w) => w.kind), ["above_maximum"]);
  assertEquals(JSON.stringify(serializeFeeResult(r)).includes("split"), true); // only inside the disclaimer
  assertEquals(
    JSON.stringify({ ...serializeFeeResult(r), disclaimer: "" }).includes("split"),
    false,
  );
});

import { estimateFromTariff, type ProviderTariff, type TariffTier } from "./fee-estimate.ts";

function tier(p: Partial<TariffTier> & { min_amount_minor: number | string; fee_type: string }): TariffTier {
  return {
    max_amount_minor: null, fixed_fee_minor: null, percentage_bps: null,
    min_fee_minor: null, max_fee_minor: null, ...p,
  };
}
function tariff(p: Partial<ProviderTariff> = {}): ProviderTariff {
  return {
    transaction_type: "send_money",
    recipient_scope: "any",
    currency: "RWF",
    effective_from: "2026-01-01T00:00:00Z",
    effective_to: null,
    source_label: "TEST tariff (fictional)",
    source_url: "https://example.invalid/t",
    note_en: null,
    verified_at: "2026-02-01T00:00:00Z",
    // fictional bands: 1-1,000 fixed 100; 1,001-10,000 fixed 250; 10,001+ 1% clamped 300..5,000; gap before 1
    tiers: [
      tier({ min_amount_minor: 1, max_amount_minor: 1000, fee_type: "fixed", fixed_fee_minor: 100 }),
      tier({ min_amount_minor: 1001, max_amount_minor: 10000, fee_type: "fixed", fixed_fee_minor: 250 }),
      tier({ min_amount_minor: 10001, fee_type: "percentage", percentage_bps: 100, min_fee_minor: 300, max_fee_minor: 5000 }),
    ],
    ...p,
  };
}

Deno.test("tariff: band edges are inclusive and pick exactly one band", () => {
  const t = tariff();
  const f = (a: bigint) => estimateFromTariff(t, a, "RWF", NOW);
  assertEquals(f(1n), { status: "exact", feeMinor: 100n });
  assertEquals(f(1000n), { status: "exact", feeMinor: 100n });
  assertEquals(f(1001n), { status: "exact", feeMinor: 250n });
  assertEquals(f(10000n), { status: "exact", feeMinor: 250n });
  // open-ended percentage band with min/max clamps: 1% of 10,001 = 100.01 -> clamped up to 300
  assertEquals(f(10001n), { status: "exact", feeMinor: 300n });
  assertEquals(f(200000n), { status: "exact", feeMinor: 2000n });
  assertEquals(f(9_999_999n), { status: "exact", feeMinor: 5000n });
});

Deno.test("tariff: an amount in a gap gets no number (never interpolated)", () => {
  assertEquals(estimateFromTariff(tariff(), 0n, "RWF", NOW), { status: "not_computable", reason: "amount_outside_bands" });
  const gappy = tariff({ tiers: [
    tier({ min_amount_minor: 100, max_amount_minor: 500, fee_type: "fixed", fixed_fee_minor: 10 }),
    tier({ min_amount_minor: 800, max_amount_minor: 900, fee_type: "fixed", fixed_fee_minor: 20 }),
  ] });
  assertEquals(estimateFromTariff(gappy, 600n, "RWF", NOW), { status: "not_computable", reason: "amount_outside_bands" });
  assertEquals(estimateFromTariff(gappy, 901n, "RWF", NOW), { status: "not_computable", reason: "amount_outside_bands" });
  assertEquals(estimateFromTariff(gappy, 500n, "RWF", NOW), { status: "exact", feeMinor: 10n });
});

Deno.test("tariff: 'none' bands are a stated zero fee, and strings from the API are accepted", () => {
  const t = tariff({ tiers: [
    tier({ min_amount_minor: "0", max_amount_minor: "999", fee_type: "none" }),
    tier({ min_amount_minor: "1000", fee_type: "fixed", fixed_fee_minor: "75" }),
  ] });
  assertEquals(estimateFromTariff(t, 500n, "RWF", NOW), { status: "exact", feeMinor: 0n });
  assertEquals(estimateFromTariff(t, 1000n, "RWF", NOW), { status: "exact", feeMinor: 75n });
});

Deno.test("tariff: unverified, out of window, wrong currency and no bands never give a number", () => {
  assertEquals(estimateFromTariff(tariff({ verified_at: null }), 500n, "RWF", NOW), { status: "not_computable", reason: "not_verified" });
  assertEquals(estimateFromTariff(tariff({ effective_to: "2026-06-01T00:00:00Z" }), 500n, "RWF", NOW), { status: "not_in_effect", reason: "expired" });
  assertEquals(estimateFromTariff(tariff({ effective_from: "2027-01-01T00:00:00Z" }), 500n, "RWF", NOW), { status: "not_in_effect", reason: "not_yet" });
  assertEquals(estimateFromTariff(tariff(), 500n, "USD", NOW), { status: "not_computable", reason: "currency_mismatch" });
  assertEquals(estimateFromTariff(tariff({ tiers: [] }), 500n, "RWF", NOW), { status: "not_computable", reason: "no_tiers" });
});

Deno.test("result: provider rows are per recipient scope, newest in-effect tariff wins, other types are ignored", () => {
  const old = tariff({ recipient_scope: "same_network", effective_from: "2025-01-01T00:00:00Z", effective_to: "2026-03-01T00:00:00Z",
    tiers: [tier({ min_amount_minor: 1, fee_type: "fixed", fixed_fee_minor: 999 })] });
  const cur = tariff({ recipient_scope: "same_network", effective_from: "2026-03-01T00:00:00Z",
    tiers: [tier({ min_amount_minor: 1, fee_type: "fixed", fixed_fee_minor: 150 })] });
  const other = tariff({ recipient_scope: "other_network",
    tiers: [tier({ min_amount_minor: 1, fee_type: "percentage", percentage_bps: 200 })] });
  const wrongType = tariff({ transaction_type: "cash_withdrawal", recipient_scope: "any",
    tiers: [tier({ min_amount_minor: 1, fee_type: "fixed", fixed_fee_minor: 5 })] });

  const r = buildFeeResult({
    amountMinor: 5000n, currency: "RWF", type: "send_money",
    history: { samples: [], capped: false }, network: null,
    provider: { slug: "x", name: "X Telecom", tariffs: [old, cur, other, wrongType] },
    now: NOW,
  });
  assertEquals(r.provider?.hasTariff, true);
  assertEquals(r.provider?.rows.map((x) => x.recipientScope), ["same_network", "other_network"]); // fixed order, no 'any'
  assertEquals(r.provider?.rows[0].estimate, { status: "exact", feeMinor: 150n }); // 'cur' beat 'old'
  assertEquals(r.provider?.rows[1].estimate, { status: "exact", feeMinor: 100n }); // 2% of 5,000
  const j = serializeFeeResult(r);
  assertEquals(j.provider_tariff?.rows[0], {
    recipient_scope: "same_network", schedule_state: "yes",
    estimate: { status: "exact", fee_minor: "150" },
    source_label: "TEST tariff (fictional)", source_url: "https://example.invalid/t",
    effective_from: "2026-03-01T00:00:00Z", effective_to: null, verified_at: "2026-02-01T00:00:00Z", note: null,
  });
  JSON.stringify(j); // no bigint survives
});

Deno.test("result: a provider with no verified tariff for this type says so; no provider means no section", () => {
  const none = buildFeeResult({
    amountMinor: 5000n, currency: "RWF", type: "send_money",
    history: { samples: [], capped: false }, network: null,
    provider: { slug: "x", name: "X Telecom", tariffs: [] }, now: NOW,
  });
  assertEquals([none.provider?.hasTariff, none.provider?.rows.length], [false, 0]);
  const bare = buildFeeResult({
    amountMinor: 5000n, currency: "RWF", type: "send_money",
    history: { samples: [], capped: false }, network: null, now: NOW,
  });
  assertEquals(bare.provider, null);
  assertEquals(serializeFeeResult(bare).provider_tariff, null);
});

Deno.test("query: provider slug is validated like a network slug", () => {
  assertEquals(parseFeeQuery({ provider: "mtn-rwanda" }, "RWF").provider, "mtn-rwanda");
  assertEquals(parseFeeQuery({ provider: "MTN Rwanda!" }, "RWF").provider, null);
  assertEquals(parseFeeQuery({}, "RWF").provider, null);
});
