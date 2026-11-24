import "server-only";

import type { supabaseSession } from "../../supabase-session-server";
import { loadNetworkFees, loadProviderTariffs } from "../../fees/fee-data";
import { guessProvider, normalizeRwandaMsisdn, providerNetworkForAccount } from "../phone";
import {
  DEFAULT_SAVING_OPTIONS,
  DEFAULT_SPLIT_THRESHOLD,
  isSplitThreshold,
  planCapacitySplit,
  planFeeSavingSplit,
  type SplitThreshold,
  THRESHOLD_MIN_SAVING_PER_EXTRA_PART,
} from "./split-math";
import { EKASH_SLUG, feeForAmount, resolveEkashRule, tariffToBands } from "./rules";

// The server-authoritative decision "should this payment be offered as a split,
// and as which parts?". The browser only ASKS (to render the card) and later
// asks to START; the plan that is stored is always recomputed here from the
// amount, never taken from the client.
//
//  - eKash: an offer exists ONLY when the amount EXCEEDS the network's
//    per-transaction capacity (RWF 10,000,000). At or below it, nothing.
//  - Fee-saving (MTN to MTN person transfer): only when the user opted in AND a
//    VERIFIED provider tariff exists. No tariff, no offer.

type Session = Awaited<ReturnType<typeof supabaseSession>>;

/**
 * service_providers.slug per mobile-money network. A verified tariff for the payer's
 * own network drives fee-saving splits, so a network with no published person-to-person
 * tariff (today: Airtel) simply never gets an offer, with no code change when one is loaded.
 */
const PROVIDER_SLUG = { mtn: "mtn-rwanda", airtel: "airtel-rwanda" } as const;

export type SplitOffer = {
  kind: "capacity" | "fee_saving";
  /** payment_networks.slug for a capacity plan, else null. */
  networkSlug: string | null;
  currency: "RWF";
  /** All money as digit strings (bigint-safe over JSON). */
  totalMinor: string;
  parts: { index: number; amountMinor: string; feeMinor: string | null }[];
  /** Fee as one transfer (fee_saving only). */
  singleFeeMinor: string | null;
  /**
   * fee_saving: the exact total fee of the parts. capacity: the sum of the
   * per-part published ceiling (a maximum, not a prediction).
   */
  plannedFeeMinor: string | null;
  savingsMinor: string | null;
  feeBasis: "verified_tariff" | "published_maximum" | "none";
  /** Per-transaction capacity that forced the split (capacity only). */
  capacityMinor: string | null;
  source: { label: string; url: string | null; asOf: string | null } | null;
  threshold: SplitThreshold | null;
};

export type SplitOfferInput = {
  paymentType: string;
  /** "ekash" when the user chose to pay over eKash; otherwise omitted. */
  networkSlug?: string | null;
  /** The paying account's provider (accounts.provider), for the network guess. */
  accountProvider?: string | null;
  recipientMsisdn?: string | null;
  amountMinor: number;
  currency: string;
};

export type SplitPrefs = { feeSavingEnabled: boolean; threshold: SplitThreshold };

export async function loadSplitPrefs(
  supabase: Session,
  userId: string,
): Promise<SplitPrefs> {
  const { data, error } = await supabase
    .from("pay_split_preferences")
    .select("fee_saving_enabled, threshold")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("split preferences query failed");
  return {
    feeSavingEnabled: data?.fee_saving_enabled === true,
    threshold: isSplitThreshold(data?.threshold) ? data.threshold : DEFAULT_SPLIT_THRESHOLD,
  };
}

const s = (v: bigint) => v.toString();

export async function getSplitOffer(args: {
  supabase: Session;
  userId: string;
  paymentNetworksEnabled: boolean;
  input: SplitOfferInput;
  now?: Date;
}): Promise<SplitOffer | null> {
  const { supabase, userId, input } = args;
  const now = args.now ?? new Date();
  if (input.currency !== "RWF") return null;
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return null;
  const total = BigInt(input.amountMinor);

  // ---- eKash: capacity split, only above the published capacity ----------
  if (input.networkSlug === EKASH_SLUG) {
    if (!args.paymentNetworksEnabled) return null;
    if (input.paymentType !== "pay_person" && input.paymentType !== "pay_merchant") return null;
    const net = await loadNetworkFees(supabase, EKASH_SLUG);
    const rule = resolveEkashRule(net?.limits ?? [], net?.fees ?? [], now);
    const plan = planCapacitySplit({
      totalMinor: total,
      capacityMinor: rule.capacityMinor,
      feePerPartMinor: rule.feePerPartMinor,
    });
    if (plan.status !== "plan") return null;

    // MTN publishes its own charge for "To another wallet or bank via eKash": a fixed
    // fee in every band. When that tariff is verified and prices every part, show the
    // exact fee instead of the network's published ceiling. Only MTN's page says it
    // is the eKash route, so other payers keep the ceiling.
    const payer = providerNetworkForAccount(input.accountProvider);
    if (payer === "mtn") {
      const loaded = await loadProviderTariffs(supabase, PROVIDER_SLUG.mtn, "bank_transfer");
      const bands = loaded ? tariffToBands(loaded.tariffs, "RWF", now) : null;
      if (bands && bands.status === "ok") {
        const fees = plan.parts.map((p) => feeForAmount(bands.bands, p.amountMinor));
        if (fees.every((f): f is bigint => f !== null)) {
          return {
            kind: "capacity",
            networkSlug: EKASH_SLUG,
            currency: "RWF",
            totalMinor: s(total),
            parts: plan.parts.map((p, i) => ({
              index: p.index,
              amountMinor: s(p.amountMinor),
              feeMinor: s(fees[i] as bigint),
            })),
            singleFeeMinor: null,
            plannedFeeMinor: s((fees as bigint[]).reduce((a, b) => a + b, 0n)),
            savingsMinor: null,
            feeBasis: "verified_tariff",
            capacityMinor: s(plan.capacityMinor),
            source: { label: bands.sourceLabel, url: bands.sourceUrl, asOf: bands.verifiedAt },
            threshold: null,
          };
        }
      }
    }
    return {
      kind: "capacity",
      networkSlug: EKASH_SLUG,
      currency: "RWF",
      totalMinor: s(total),
      parts: plan.parts.map((p) => ({
        index: p.index,
        amountMinor: s(p.amountMinor),
        feeMinor: p.feeMinor === null ? null : s(p.feeMinor),
      })),
      singleFeeMinor: null,
      plannedFeeMinor: plan.feeCeilingMinor === null ? null : s(plan.feeCeilingMinor),
      savingsMinor: null,
      feeBasis: plan.feeCeilingMinor === null ? "none" : "published_maximum",
      capacityMinor: s(plan.capacityMinor),
      source: { label: rule.sourceLabel, url: null, asOf: null },
      threshold: null,
    };
  }

  // ---- fee-saving: person transfer to a number on the payer's own network --
  if (input.networkSlug) return null; // some other network: nothing to optimise
  if (input.paymentType !== "pay_person") return null;
  const norm = input.recipientMsisdn ? normalizeRwandaMsisdn(input.recipientMsisdn) : null;
  const recipientProvider = norm?.normalized ? guessProvider(norm.normalized) : null;
  const payerProvider = providerNetworkForAccount(input.accountProvider);
  if (!payerProvider || payerProvider !== recipientProvider) return null;

  const prefs = await loadSplitPrefs(supabase, userId);
  if (!prefs.feeSavingEnabled) return null;

  const loaded = await loadProviderTariffs(supabase, PROVIDER_SLUG[payerProvider], "send_money");
  if (!loaded) return null;
  const bands = tariffToBands(loaded.tariffs, "RWF", now);
  if (bands.status !== "ok") return null;

  const result = planFeeSavingSplit(bands.bands, total, {
    ...DEFAULT_SAVING_OPTIONS,
    minSavingsPerExtraPartMinor: THRESHOLD_MIN_SAVING_PER_EXTRA_PART[prefs.threshold],
  });
  if (result.status !== "plan") return null;
  return {
    kind: "fee_saving",
    networkSlug: null,
    currency: "RWF",
    totalMinor: s(total),
    parts: result.parts.map((p) => ({
      index: p.index,
      amountMinor: s(p.amountMinor),
      feeMinor: p.feeMinor === null ? null : s(p.feeMinor),
    })),
    singleFeeMinor: s(result.singleFeeMinor),
    plannedFeeMinor: s(result.plannedFeeMinor),
    savingsMinor: s(result.savingsMinor),
    feeBasis: "verified_tariff",
    capacityMinor: null,
    source: { label: bands.sourceLabel, url: bands.sourceUrl, asOf: bands.verifiedAt },
    threshold: prefs.threshold,
  };
}
