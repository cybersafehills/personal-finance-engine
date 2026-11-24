import { assertEquals } from "jsr:@std/assert@1";
import type { ProviderTariff } from "../../fees/fee-estimate.ts";
import { EKASH_FALLBACK, resolveEkashRule, tariffToBands } from "./rules.ts";

const NOW = new Date("2026-12-01T00:00:00Z");

function tariff(over: Partial<ProviderTariff> = {}): ProviderTariff {
  return {
    transaction_type: "send_money",
    recipient_scope: "same_network",
    currency: "RWF",
    effective_from: "2026-01-01T00:00:00Z",
    effective_to: null,
    source_label: "Test source",
    source_url: "https://example.test/tariff",
    note_en: null,
    verified_at: "2026-11-30T00:00:00Z",
    tiers: [
      { min_amount_minor: 1, max_amount_minor: 1000, fee_type: "fixed", fixed_fee_minor: 20, percentage_bps: null, min_fee_minor: null, max_fee_minor: null },
      { min_amount_minor: 1001, max_amount_minor: null, fee_type: "fixed", fixed_fee_minor: 100, percentage_bps: null, min_fee_minor: null, max_fee_minor: null },
    ],
    ...over,
  } as ProviderTariff;
}

Deno.test("eKash rule: no rows falls back to the owner-confirmed figures", () => {
  const r = resolveEkashRule([], [], NOW);
  assertEquals(r.capacityMinor, EKASH_FALLBACK.capacityMinor);
  assertEquals(r.feePerPartMinor, 20n);
});

Deno.test("eKash rule: stored rows win over the fallback", () => {
  const r = resolveEkashRule(
    [{ max_txn_minor: "8000000", currency: "RWF", effective_from: null, effective_to: null, source_label: "Operator notice" }],
    [{ fee_type: "published_maximum", fixed_fee_minor: null, max_fee_minor: 25, currency: "RWF", effective_from: null, effective_to: null }],
    NOW,
  );
  assertEquals(r.capacityMinor, 8_000_000n);
  assertEquals(r.feePerPartMinor, 25n);
  assertEquals(r.sourceLabel, "Operator notice");
});

Deno.test("eKash rule: an expired row is ignored", () => {
  const r = resolveEkashRule(
    [{ max_txn_minor: 5, currency: "RWF", effective_from: null, effective_to: "2026-06-01T00:00:00Z", source_label: null }],
    [],
    NOW,
  );
  assertEquals(r.capacityMinor, EKASH_FALLBACK.capacityMinor);
});

Deno.test("tariff bands: no verified tariff gives no bands", () => {
  assertEquals(tariffToBands([], "RWF", NOW), { status: "unusable", reason: "no_verified_tariff" });
  assertEquals(
    tariffToBands([tariff({ verified_at: null })], "RWF", NOW),
    { status: "unusable", reason: "no_verified_tariff" },
  );
});

Deno.test("tariff bands: a verified fixed-fee tariff becomes bands, open top band allowed", () => {
  const r = tariffToBands([tariff()], "RWF", NOW);
  if (r.status !== "ok") throw new Error("expected bands");
  assertEquals(r.bands.length, 2);
  assertEquals(r.bands[1].toMinor, null);
  assertEquals(r.sourceLabel, "Test source");
});

Deno.test("tariff bands: a percentage tier is refused, never approximated", () => {
  const t = tariff({
    tiers: [
      { min_amount_minor: 1, max_amount_minor: null, fee_type: "percentage", fixed_fee_minor: null, percentage_bps: 50, min_fee_minor: null, max_fee_minor: null },
    ],
  } as Partial<ProviderTariff>);
  assertEquals(tariffToBands([t], "RWF", NOW), { status: "unusable", reason: "variable_fee_band" });
});

Deno.test("tariff bands: not yet in effect, wrong currency, and scope preference", () => {
  assertEquals(
    tariffToBands([tariff({ effective_from: "2027-01-01T00:00:00Z" })], "RWF", NOW),
    { status: "unusable", reason: "not_in_effect" },
  );
  assertEquals(tariffToBands([tariff()], "EUR", NOW), { status: "unusable", reason: "currency_mismatch" });
  const generic = tariff({ recipient_scope: "any", source_label: "generic" });
  const same = tariff({ recipient_scope: "same_network", source_label: "same" });
  const r = tariffToBands([generic, same], "RWF", NOW);
  if (r.status !== "ok") throw new Error("expected bands");
  assertEquals(r.sourceLabel, "same");
  // another network's tariff is never used
  assertEquals(
    tariffToBands([tariff({ recipient_scope: "other_network" })], "RWF", NOW),
    { status: "unusable", reason: "no_verified_tariff" },
  );
});

import { feeForAmount } from "./rules.ts";

Deno.test("feeForAmount prices inside a band and returns null outside every band", () => {
  const bands = [
    { fromMinor: 101n, toMinor: 300n, feeMinor: 30n },
    { fromMinor: 301n, toMinor: null, feeMinor: 50n },
  ];
  assertEquals(feeForAmount(bands, 100n), null); // below the first published band: no invented 0
  assertEquals(feeForAmount(bands, 101n), 30n);
  assertEquals(feeForAmount(bands, 300n), 30n);
  assertEquals(feeForAmount(bands, 301n), 50n);
  assertEquals(feeForAmount(bands, 99_999_999n), 50n);
});
