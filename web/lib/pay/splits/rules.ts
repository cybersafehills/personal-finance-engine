// Payment splits - rules that turn stored data into inputs for split-math.ts.
// PURE: no I/O, no framework imports, deno-testable.

import {
  inEffect,
  type ProviderTariff,
} from "../../fees/fee-estimate.ts";
import { type FeeBand } from "./split-math.ts";

/** payment_networks.slug of eKash. */
export const EKASH_SLUG = "ekash";

/**
 * The eKash rule, as confirmed by the product owner (2026-11-23): amounts up to
 * RWF 10,000,000 go as ONE transfer for RWF 20; only an amount ABOVE that is
 * ever suggested as a split. This is the fallback when the network's own
 * `route_limits` / `route_fees` rows are missing; when they exist they win, so
 * correcting the data corrects the behaviour without a deploy.
 */
export const EKASH_FALLBACK = {
  capacityMinor: 10_000_000n,
  feePerPartMinor: 20n,
  sourceLabel: "Confirmed by OneLedger's product owner, 2026-11-23",
} as const;

export type EkashRule = {
  capacityMinor: bigint;
  /** A ceiling per part (published maximum), not a prediction. */
  feePerPartMinor: bigint | null;
  sourceLabel: string;
};

type LimitLike = {
  max_txn_minor: number | string | null;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
  source_label: string | null;
};
type FeeLike = {
  fee_type: string;
  fixed_fee_minor: number | string | null;
  max_fee_minor: number | string | null;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
};

function toBig(v: number | string | null | undefined): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return typeof v === "string" ? BigInt(v) : BigInt(Math.trunc(v));
  } catch {
    return null;
  }
}

/**
 * Capacity and per-part fee for eKash, from the network's stored rows when
 * present (in effect, RWF), else the owner-confirmed fallback.
 */
export function resolveEkashRule(
  limits: readonly LimitLike[],
  fees: readonly FeeLike[],
  now: Date,
): EkashRule {
  const caps = limits
    .filter((l) => l.currency === "RWF" && inEffect(l, now) === "yes")
    .map((l) => ({ cap: toBig(l.max_txn_minor), label: l.source_label }))
    .filter((x): x is { cap: bigint; label: string | null } => x.cap !== null && x.cap > 0n);
  const published = caps.sort((a, b) => (a.cap > b.cap ? -1 : a.cap < b.cap ? 1 : 0))[0];

  const fee = fees
    .filter((f) => f.currency === "RWF" && inEffect(f, now) === "yes")
    .map((f) => {
      if (f.fee_type === "fixed") return toBig(f.fixed_fee_minor);
      if (f.fee_type === "published_maximum") return toBig(f.max_fee_minor);
      return null;
    })
    .find((x): x is bigint => x !== null);

  return {
    capacityMinor: published?.cap ?? EKASH_FALLBACK.capacityMinor,
    feePerPartMinor: fee ?? EKASH_FALLBACK.feePerPartMinor,
    sourceLabel: published?.label ?? EKASH_FALLBACK.sourceLabel,
  };
}

// ------------------------- provider tariff -> fee bands -------------------

export type TariffBands =
  | {
    status: "ok";
    bands: FeeBand[];
    sourceLabel: string;
    sourceUrl: string | null;
    effectiveFrom: string | null;
    verifiedAt: string;
  }
  | {
    status: "unusable";
    reason:
      | "no_verified_tariff"
      | "not_in_effect"
      | "no_tiers"
      | "variable_fee_band"
      | "currency_mismatch";
  };

/**
 * Pick the verified tariff to optimise against and turn its tiers into constant-fee
 * bands. Only `fixed` and `none` tiers are constant across their band; a
 * percentage tier is not, so a tariff that has one yields no offer (rather than a
 * guess). The tariff for the same network is preferred over a generic one.
 */
export function tariffToBands(
  tariffs: readonly ProviderTariff[],
  currency: string,
  now: Date,
): TariffBands {
  const verified = tariffs.filter((t) => t.verified_at !== null);
  if (verified.length === 0) return { status: "unusable", reason: "no_verified_tariff" };
  const sameCurrency = verified.filter((t) => t.currency === currency);
  if (sameCurrency.length === 0) return { status: "unusable", reason: "currency_mismatch" };
  const live = sameCurrency.filter((t) => inEffect(t, now) === "yes");
  if (live.length === 0) return { status: "unusable", reason: "not_in_effect" };

  const rank = (t: ProviderTariff) => (t.recipient_scope === "same_network" ? 0 : t.recipient_scope === "any" ? 1 : 2);
  const chosen = [...live]
    .filter((t) => rank(t) < 2)
    .sort((a, b) => rank(a) - rank(b))[0];
  if (!chosen) return { status: "unusable", reason: "no_verified_tariff" };
  if (chosen.tiers.length === 0) return { status: "unusable", reason: "no_tiers" };

  const bands: FeeBand[] = [];
  for (const tier of chosen.tiers) {
    const from = toBig(tier.min_amount_minor);
    if (from === null) return { status: "unusable", reason: "no_tiers" };
    const to = tier.max_amount_minor === null ? null : toBig(tier.max_amount_minor);
    let fee: bigint | null;
    if (tier.fee_type === "none") fee = 0n;
    else if (tier.fee_type === "fixed") fee = toBig(tier.fixed_fee_minor);
    else fee = null;
    if (fee === null) return { status: "unusable", reason: "variable_fee_band" };
    bands.push({ fromMinor: from, toMinor: to, feeMinor: fee });
  }
  return {
    status: "ok",
    bands,
    sourceLabel: chosen.source_label ?? "",
    sourceUrl: chosen.source_url,
    effectiveFrom: chosen.effective_from,
    verifiedAt: chosen.verified_at as string,
  };
}
