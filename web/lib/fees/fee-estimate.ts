// Transfer-fee estimates (OneLedger 3.0, spec §9 "Transfer fee intelligence").
// PURE: no I/O, no framework imports, deno-testable.
//
// Two independent kinds of evidence, never blended into one number:
//
//  1. PUBLISHED schedule - a source-attributed, dated route_fees row for a
//     payment network. Turned into a number only when the row actually says
//     how: a fixed amount, a percentage (with optional min/max), "none", or a
//     published MAXIMUM (an upper bound, never a prediction). A "tiered",
//     "unknown" or "varies by institution" fee yields NO number - the schema
//     stores no tiers, so inventing one would be fabrication.
//  2. HISTORY - the fees this Space actually paid on similar past payments of
//     the same type, read from the user's own ledger. Reported as an observed
//     range with how many payments it rests on; with too few, no estimate.
//
// Money is bigint minor units with an explicit currency. Percentages are
// integer basis points. No floating point touches an amount.
//
// Out of scope HERE: comparing "one transfer vs several smaller ones". This
// calculator only reports a fee and warns about limits (see limitWarnings). Split
// suggestions live in Pay (lib/pay/splits), where an amount above a network's
// per-transaction capacity, or a verified cheaper split, is offered as parts that
// the user sends one at a time.

import { isSupportedCurrency, minorUnitsPerMajor } from "../money.ts";

// ----------------------------- published schedule -------------------------

export type FeeSchedule = {
  fee_type: string;
  fixed_fee_minor: number | string | null;
  percentage_bps: number | string | null;
  min_fee_minor: number | string | null;
  max_fee_minor: number | string | null;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
  source_url: string | null;
  source_label: string | null;
  note_en: string | null;
};

export type NotComputableReason =
  | "tiered"
  | "unknown"
  | "varies_by_institution"
  | "incomplete"
  | "currency_mismatch"
  | "unrecognised"
  /** A provider tariff with no amount bands recorded. */
  | "no_tiers"
  /** The amount falls in a gap between (or beyond) the published bands. */
  | "amount_outside_bands"
  /** Defence in depth: a tariff that has not been verified is never turned into a number. */
  | "not_verified";

export type PublishedEstimate =
  /** The schedule states exactly one amount (fixed fee, or no fee). */
  | { status: "exact"; feeMinor: bigint }
  /** A percentage: the whole-unit fee lies between floor and ceiling. */
  | { status: "range"; minMinor: bigint; maxMinor: bigint }
  /** A published MAXIMUM: the fee is at most this; the actual fee is not stated. */
  | { status: "upper_bound"; maxMinor: bigint }
  | { status: "not_computable"; reason: NotComputableReason }
  /** The schedule is not in effect at `now`. */
  | { status: "not_in_effect"; reason: "not_yet" | "expired" };

function big(v: number | string | null | undefined): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return typeof v === "string" ? BigInt(v) : BigInt(Math.trunc(v));
  } catch {
    return null;
  }
}

/** Is `s` in effect at `now`? effective_from inclusive, effective_to exclusive. */
export function inEffect(
  s: { effective_from: string | null; effective_to: string | null },
  now: Date,
): "yes" | "not_yet" | "expired" {
  const t = now.getTime();
  if (s.effective_from && Date.parse(s.effective_from) > t) return "not_yet";
  if (s.effective_to && Date.parse(s.effective_to) <= t) return "expired";
  return "yes";
}

export function estimatePublishedFee(
  fee: FeeSchedule,
  amountMinor: bigint,
  currency: string,
  now: Date,
): PublishedEstimate {
  const eff = inEffect(fee, now);
  if (eff !== "yes") return { status: "not_in_effect", reason: eff };
  if (fee.currency !== currency) {
    return { status: "not_computable", reason: "currency_mismatch" };
  }

  const fixed = big(fee.fixed_fee_minor);
  const bps = big(fee.percentage_bps);
  const min = big(fee.min_fee_minor);
  const max = big(fee.max_fee_minor);

  switch (fee.fee_type) {
    case "none":
      return { status: "exact", feeMinor: 0n };
    case "fixed":
      return fixed === null
        ? { status: "not_computable", reason: "incomplete" }
        : { status: "exact", feeMinor: fixed };
    case "percentage": {
      if (bps === null) {
        return { status: "not_computable", reason: "incomplete" };
      }
      const num = amountMinor * bps;
      let lo = num / 10000n; // floor
      let hi = (num + 9999n) / 10000n; // ceiling
      if (min !== null) {
        if (lo < min) lo = min;
        if (hi < min) hi = min;
      }
      if (max !== null) {
        if (lo > max) lo = max;
        if (hi > max) hi = max;
      }
      return lo === hi
        ? { status: "exact", feeMinor: lo }
        : { status: "range", minMinor: lo, maxMinor: hi };
    }
    case "published_maximum":
      return max === null
        ? { status: "not_computable", reason: "incomplete" }
        : { status: "upper_bound", maxMinor: max };
    case "tiered":
    case "unknown":
    case "varies_by_institution":
      return { status: "not_computable", reason: fee.fee_type };
    default:
      return { status: "not_computable", reason: "unrecognised" };
  }
}

/**
 * Which schedule row applies now. Among rows in effect, the one that took
 * effect most recently; otherwise the most recent expired / upcoming row so
 * the page can say WHY nothing applies instead of silently showing nothing.
 */
export function pickSchedule<
  T extends { effective_from: string | null; effective_to: string | null },
>(
  rows: readonly T[],
  now: Date,
): { schedule: T; state: "yes" | "not_yet" | "expired" } | null {
  const rank = (r: T) => Date.parse(r.effective_from ?? "") || 0;
  const byRecent = [...rows].sort((a, b) => rank(b) - rank(a));
  for (const state of ["yes", "expired", "not_yet"] as const) {
    const hit = byRecent.find((r) => inEffect(r, now) === state);
    if (hit) return { schedule: hit, state };
  }
  return null;
}

// ----------------------------- provider tariffs ---------------------------
// A provider's own tariff (MTN, Airtel, a bank): amount bands, each with a
// fixed fee, a percentage, or no fee. Read from provider_tariffs /
// provider_tariff_tiers, which clients can only see once a human has verified
// them against their cited source (20270107000000_provider_tariffs.sql).

export const RECIPIENT_SCOPES = [
  "any",
  "same_network",
  "other_network",
  "unregistered",
] as const;
export type RecipientScope = typeof RECIPIENT_SCOPES[number];

export const RECIPIENT_SCOPE_LABEL: Record<RecipientScope, string> = {
  any: "To anyone",
  same_network: "To a number on the same network",
  other_network: "To a number on another network",
  unregistered: "To a number that isn't registered",
};

export type TariffTier = {
  min_amount_minor: number | string;
  max_amount_minor: number | string | null;
  fee_type: string;
  fixed_fee_minor: number | string | null;
  percentage_bps: number | string | null;
  min_fee_minor: number | string | null;
  max_fee_minor: number | string | null;
};

export type ProviderTariff = {
  transaction_type: string;
  recipient_scope: string;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
  source_label: string | null;
  source_url: string | null;
  note_en: string | null;
  verified_at: string | null;
  tiers: readonly TariffTier[];
};

/**
 * The fee a tariff gives for `amountMinor`: the band that contains the amount
 * (bands are inclusive), turned into a number by the same exact rules as a
 * published schedule. An amount in a gap, or a tariff with no bands, gives NO
 * number - the calculator never interpolates between bands.
 */
export function estimateFromTariff(
  t: ProviderTariff,
  amountMinor: bigint,
  currency: string,
  now: Date,
): PublishedEstimate {
  if (!t.verified_at) return { status: "not_computable", reason: "not_verified" };
  const eff = inEffect(t, now);
  if (eff !== "yes") return { status: "not_in_effect", reason: eff };
  if (t.currency !== currency) {
    return { status: "not_computable", reason: "currency_mismatch" };
  }
  if (t.tiers.length === 0) {
    return { status: "not_computable", reason: "no_tiers" };
  }
  const tier = t.tiers.find((x) => {
    const min = big(x.min_amount_minor);
    const max = big(x.max_amount_minor);
    return min !== null && amountMinor >= min && (max === null || amountMinor <= max);
  });
  if (!tier) return { status: "not_computable", reason: "amount_outside_bands" };
  return estimatePublishedFee(
    {
      fee_type: tier.fee_type,
      fixed_fee_minor: tier.fixed_fee_minor,
      percentage_bps: tier.percentage_bps,
      min_fee_minor: tier.min_fee_minor,
      max_fee_minor: tier.max_fee_minor,
      currency: t.currency,
      effective_from: t.effective_from,
      effective_to: t.effective_to,
      source_url: t.source_url,
      source_label: t.source_label,
      note_en: t.note_en,
    },
    amountMinor,
    currency,
    now,
  );
}

// --------------------------------- limits ---------------------------------

export type LimitRow = {
  min_txn_minor: number | string | null;
  max_txn_minor: number | string | null;
  daily_limit_minor: number | string | null;
  currency: string;
  is_published_maximum: boolean;
  effective_from: string | null;
  effective_to: string | null;
  source_label: string | null;
};

export type LimitWarning = {
  kind: "below_minimum" | "above_maximum" | "above_daily";
  limitMinor: bigint;
  /** The platform's published ceiling (institutions may enforce lower limits). */
  publishedMaximum: boolean;
};

/**
 * Warnings only. This deliberately never proposes splitting an amount to fit
 * under a limit (spec §9): the page tells the user the limit and sends them to
 * the provider's own rules.
 */
export function limitWarnings(
  limits: readonly LimitRow[],
  amountMinor: bigint,
  currency: string,
  now: Date,
): LimitWarning[] {
  const out: LimitWarning[] = [];
  for (const l of limits) {
    if (l.currency !== currency || inEffect(l, now) !== "yes") continue;
    const min = big(l.min_txn_minor);
    const max = big(l.max_txn_minor);
    const daily = big(l.daily_limit_minor);
    if (min !== null && amountMinor < min) {
      out.push({
        kind: "below_minimum",
        limitMinor: min,
        publishedMaximum: false,
      });
    }
    if (max !== null && amountMinor > max) {
      out.push({
        kind: "above_maximum",
        limitMinor: max,
        publishedMaximum: l.is_published_maximum,
      });
    }
    if (daily !== null && amountMinor > daily) {
      out.push({
        kind: "above_daily",
        limitMinor: daily,
        publishedMaximum: l.is_published_maximum,
      });
    }
  }
  return out;
}

// --------------------------------- history --------------------------------

export type HistorySample = {
  amountMinor: bigint;
  feeMinor: bigint;
  /** ISO instant the payment happened. */
  at: string;
};

/** A past payment counts as "similar" within this share of the requested amount. */
export const SIMILAR_WINDOW_PERCENT = 20n;
/** Fewer similar payments than this is not enough to say anything. */
export const MIN_SIMILAR_SAMPLES = 3;
/** The usual fee is named only if at least this share (basis points) paid it. */
export const TYPICAL_SHARE_BPS = 6000n;

export type HistoryEstimate =
  | {
    status: "estimate";
    minMinor: bigint;
    maxMinor: bigint;
    /** The fee most of them paid, when one fee covers >= TYPICAL_SHARE_BPS. */
    typicalMinor: bigint | null;
    count: number;
    windowLowMinor: bigint;
    windowHighMinor: bigint;
    firstAt: string;
    lastAt: string;
    /** The similar payments, newest first (for transparency, capped). */
    recent: HistorySample[];
  }
  | { status: "not_enough_history"; similarCount: number; totalCount: number }
  | { status: "no_history" };

export const RECENT_SHOWN = 5;

export function estimateFromHistory(
  samples: readonly HistorySample[],
  amountMinor: bigint,
): HistoryEstimate {
  if (samples.length === 0) return { status: "no_history" };

  // +-20% of the requested amount, in integer arithmetic (low rounds up).
  const low = (amountMinor * (100n - SIMILAR_WINDOW_PERCENT) + 99n) / 100n;
  const high = (amountMinor * (100n + SIMILAR_WINDOW_PERCENT)) / 100n;
  const similar = samples
    .filter((s) => s.amountMinor >= low && s.amountMinor <= high)
    .sort((a, b) =>
      a.at === b.at ? 0 : a.at < b.at ? 1 : -1 // newest first
    );

  if (similar.length < MIN_SIMILAR_SAMPLES) {
    return {
      status: "not_enough_history",
      similarCount: similar.length,
      totalCount: samples.length,
    };
  }

  let min = similar[0].feeMinor, max = similar[0].feeMinor;
  const tally = new Map<string, number>();
  for (const s of similar) {
    if (s.feeMinor < min) min = s.feeMinor;
    if (s.feeMinor > max) max = s.feeMinor;
    const k = s.feeMinor.toString();
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  let topFee = "", topCount = 0;
  for (const [fee, n] of tally) {
    // ties go to the larger fee: never understate
    if (n > topCount || (n === topCount && BigInt(fee) > BigInt(topFee))) {
      topFee = fee;
      topCount = n;
    }
  }
  const share = (BigInt(topCount) * 10000n) / BigInt(similar.length);

  return {
    status: "estimate",
    minMinor: min,
    maxMinor: max,
    typicalMinor: share >= TYPICAL_SHARE_BPS ? BigInt(topFee) : null,
    count: similar.length,
    windowLowMinor: low,
    windowHighMinor: high,
    firstAt: similar[similar.length - 1].at,
    lastAt: similar[0].at,
    recent: similar.slice(0, RECENT_SHOWN),
  };
}

// ---------------------------------- input ---------------------------------

/** The outgoing transaction types a fee can be estimated for. */
export const FEE_TRANSACTION_TYPES: readonly {
  value: string;
  label: string;
}[] = [
  { value: "send_money", label: "Send money to a person" },
  { value: "merchant_payment", label: "Pay a merchant" },
  { value: "cash_withdrawal", label: "Withdraw cash" },
  { value: "bill_payment", label: "Pay a bill" },
  { value: "airtime", label: "Buy airtime" },
  { value: "bank_transfer", label: "Bank transfer" },
];

export function isFeeTransactionType(v: string): boolean {
  return FEE_TRANSACTION_TYPES.some((t) => t.value === v);
}

const MAX_MINOR_DIGITS = 15;
const NETWORK_SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FeeQuery = {
  amountText: string;
  amountMinor: bigint | null;
  amountError: string | null;
  currency: string;
  type: string;
  network: string | null;
  /** service_providers.slug whose own tariff to read (MTN, Airtel, ...). */
  provider: string | null;
  workspaceId: string | null;
};

type Raw = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = typeof s === "string" ? s.trim() : "";
  return t ? t : undefined;
}

/**
 * Exact amount parsing: text -> minor units of `currency`. A fraction the
 * currency cannot hold is refused, not rounded; zero and negatives are refused
 * (there is no fee to estimate on nothing); a currency whose decimal places
 * are unknown is refused.
 */
export function parseFeeAmount(
  text: string,
  currency: string,
): { ok: true; minor: bigint } | { ok: false; error: string } {
  if (!isSupportedCurrency(currency)) {
    return { ok: false, error: `Fees in ${currency} can't be estimated yet.` };
  }
  const decimals = minorUnitsPerMajor(currency).toString().length - 1;
  const invalid = {
    ok: false as const,
    error: decimals === 0
      ? "Enter a whole amount, like 25,000."
      : "Enter an amount, like 25,000.50.",
  };
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.replace(/[,\s]/g, ""));
  if (!m) return invalid;
  const frac = m[2] ?? "";
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    return invalid;
  }
  const digits = m[1] + frac.padEnd(decimals, "0").slice(0, decimals);
  if (digits.replace(/^0+/, "").length > MAX_MINOR_DIGITS) {
    return { ok: false, error: "That amount is too large." };
  }
  const minor = BigInt(digits);
  if (minor <= 0n) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }
  return { ok: true, minor };
}

export function parseFeeQuery(sp: Raw, defaultCurrency: string): FeeQuery {
  const currencyRaw = one(sp.currency)?.toUpperCase();
  const currency = currencyRaw && /^[A-Z]{3}$/.test(currencyRaw)
    ? currencyRaw
    : defaultCurrency;
  const amountText = (one(sp.amount) ?? "").slice(0, 40);
  const typeRaw = one(sp.type);
  const netRaw = one(sp.network);
  const provRaw = one(sp.provider);
  const wsRaw = one(sp.workspace_id);

  let amountMinor: bigint | null = null;
  let amountError: string | null = null;
  if (amountText) {
    const p = parseFeeAmount(amountText, currency);
    if (p.ok) amountMinor = p.minor;
    else amountError = p.error;
  }
  return {
    amountText,
    amountMinor,
    amountError,
    currency,
    type: typeRaw && isFeeTransactionType(typeRaw) ? typeRaw : "send_money",
    network: netRaw && NETWORK_SLUG.test(netRaw) ? netRaw : null,
    provider: provRaw && NETWORK_SLUG.test(provRaw) ? provRaw : null,
    workspaceId: wsRaw && UUID.test(wsRaw) ? wsRaw : null,
  };
}
