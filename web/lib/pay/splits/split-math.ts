// Payment splits - the pure maths (OneLedger Pay, "Splits").
// PURE: no I/O, no framework imports, deno-testable.
//
// Two kinds of split, kept apart because they exist for different reasons:
//
//  1. CAPACITY split (planCapacitySplit). A network publishes a per-transaction
//     capacity (eKash: RWF 10,000,000). An amount ABOVE it cannot go as one
//     transfer, so it is offered as the fewest equal-ish parts that each fit.
//     It is offered ONLY when the amount exceeds the capacity - never for an
//     amount that already fits.
//
//  2. FEE-SAVING split (planFeeSavingSplit). A provider's fee is a step function
//     of the amount, so some amounts cost less as two or more parts. Driven
//     entirely by verified fee bands passed in by the caller - this module holds
//     no tariff of its own. With no bands there is no offer.
//
// Money is bigint minor units. No floating point touches an amount.
// Neither function moves money or decides anything on the user's behalf: they
// return a PROPOSAL the user may take, part by part, through the normal Pay
// hand-off.

export type SplitPart = {
  /** 1-based position; part 1 is dialled first. */
  index: number;
  amountMinor: bigint;
  /** The fee this part is expected to cost, when known. */
  feeMinor: bigint | null;
};

// --------------------------------- fee bands ------------------------------

/** One inclusive amount band with a constant fee. `toMinor: null` = no upper bound. */
export type FeeBand = {
  fromMinor: bigint;
  toMinor: bigint | null;
  feeMinor: bigint;
};

function bandFor(bands: readonly FeeBand[], amount: bigint): FeeBand | null {
  return bands.find((b) =>
    amount >= b.fromMinor && (b.toMinor === null || amount <= b.toMinor)
  ) ?? null;
}

/** Bands must be non-negative, well-formed and not overlap (gaps are allowed). */
export function bandsAreValid(bands: readonly FeeBand[]): boolean {
  if (bands.length === 0) return false;
  const sorted = [...bands].sort((a, b) => (a.fromMinor < b.fromMinor ? -1 : a.fromMinor > b.fromMinor ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.fromMinor < 0n || b.feeMinor < 0n) return false;
    if (b.toMinor !== null && b.toMinor < b.fromMinor) return false;
    if (i > 0) {
      const prev = sorted[i - 1];
      if (prev.toMinor === null || b.fromMinor <= prev.toMinor) return false;
    }
  }
  return true;
}

// --------------------------- fee-saving split -----------------------------

export type SavingOptions = {
  /** Most parts to consider. Dial It uses 5. */
  maxParts: number;
  /** The plan must save at least this much in total. */
  minTotalSavingsMinor: bigint;
  /** ...and at least this much for every part beyond the first. */
  minSavingsPerExtraPartMinor: bigint;
  /** Smallest amount one part may be. At least 1. Raise it from a verified minimum. */
  minPartMinor: bigint;
};

export const DEFAULT_SAVING_OPTIONS: SavingOptions = {
  maxParts: 5,
  minTotalSavingsMinor: 0n,
  minSavingsPerExtraPartMinor: 50n,
  minPartMinor: 1n,
};

/** The user's "when should we suggest splitting?" choice. */
export const SPLIT_THRESHOLDS = ["any", "balanced", "bigger"] as const;
export type SplitThreshold = (typeof SPLIT_THRESHOLDS)[number];
export const DEFAULT_SPLIT_THRESHOLD: SplitThreshold = "balanced";

/** RWF saved per extra part that each choice requires. */
export const THRESHOLD_MIN_SAVING_PER_EXTRA_PART: Record<SplitThreshold, bigint> = {
  any: 0n,
  balanced: 50n,
  bigger: 250n,
};

export function isSplitThreshold(v: unknown): v is SplitThreshold {
  return typeof v === "string" && (SPLIT_THRESHOLDS as readonly string[]).includes(v);
}

export type FeeSavingResult =
  | {
    status: "none";
    reason:
      | "invalid_bands"
      | "amount_outside_bands"
      | "no_saving"
      | "threshold_not_met";
  }
  | {
    status: "plan";
    singleFeeMinor: bigint;
    plannedFeeMinor: bigint;
    savingsMinor: bigint;
    parts: SplitPart[];
  };

/**
 * The cheapest way to send `totalMinor` as 2..maxParts parts, or none.
 *
 * Exact, not heuristic: every part sits in one band and pays that band's fee, so
 * a plan is a multiset of bands. We try every multiset of up to `maxParts` bands
 * (a handful with a real tariff), keep those that can actually add up to the
 * amount, and pick the lowest total fee - fewest parts on a tie. Parts are then
 * laid out largest-first.
 */
export function planFeeSavingSplit(
  bandsIn: readonly FeeBand[],
  totalMinor: bigint,
  options: SavingOptions,
): FeeSavingResult {
  if (!bandsAreValid(bandsIn)) return { status: "none", reason: "invalid_bands" };
  if (totalMinor <= 0n) return { status: "none", reason: "amount_outside_bands" };
  const maxParts = Math.min(Math.max(Math.trunc(options.maxParts), 2), 12);
  const minPart = options.minPartMinor < 1n ? 1n : options.minPartMinor;

  // Highest band first, so ties resolve to the larger first part.
  const bands = [...bandsIn].sort((a, b) =>
    a.fromMinor < b.fromMinor ? 1 : a.fromMinor > b.fromMinor ? -1 : 0
  );
  const single = bandFor(bands, totalMinor);
  if (!single) return { status: "none", reason: "amount_outside_bands" };

  const lo = bands.map((b) => (b.fromMinor < minPart ? minPart : b.fromMinor));
  const hi = bands.map((b) => (b.toMinor === null || b.toMinor > totalMinor ? totalMinor : b.toMinor));
  const usable = bands.map((_, i) => lo[i] <= hi[i]);

  let best: { fee: bigint; picks: number[] } | null = null;
  let sawSaving = false;

  for (let k = 2; k <= maxParts; k++) {
    const picks: number[] = [];
    const walk = (from: number, sumLo: bigint, sumHi: bigint, fee: bigint) => {
      if (picks.length === k) {
        if (sumLo > totalMinor || sumHi < totalMinor) return;
        const savings = single.feeMinor - fee;
        if (savings <= 0n) return;
        sawSaving = true;
        const need = options.minSavingsPerExtraPartMinor * BigInt(k - 1);
        const floor = options.minTotalSavingsMinor > need ? options.minTotalSavingsMinor : need;
        if (savings < floor) return;
        // Strictly lower only: an earlier (fewer-parts, higher-band) plan wins ties.
        if (best === null || fee < best.fee) best = { fee, picks: [...picks] };
        return;
      }
      // Bands are indexed highest-first; picks are non-decreasing in index so
      // each multiset is visited once, highest band first.
      for (let i = from; i < bands.length; i++) {
        if (!usable[i]) continue;
        picks.push(i);
        walk(i, sumLo + lo[i], sumHi + hi[i], fee + bands[i].feeMinor);
        picks.pop();
      }
    };
    walk(0, 0n, 0n, 0n);
  }

  if (best === null) {
    return { status: "none", reason: sawSaving ? "threshold_not_met" : "no_saving" };
  }

  const chosen = (best as { fee: bigint; picks: number[] }).picks;
  const amounts = chosen.map((i) => lo[i]);
  let rem = totalMinor - amounts.reduce((s, a) => s + a, 0n);
  for (let p = 0; p < chosen.length && rem > 0n; p++) {
    const room = hi[chosen[p]] - amounts[p];
    const add = rem < room ? rem : room;
    amounts[p] += add;
    rem -= add;
  }
  if (rem !== 0n) return { status: "none", reason: "no_saving" }; // unreachable by construction

  const parts: SplitPart[] = chosen.map((bi, p) => ({
    index: p + 1,
    amountMinor: amounts[p],
    feeMinor: bands[bi].feeMinor,
  }));
  const planned = (best as { fee: bigint; picks: number[] }).fee;
  return {
    status: "plan",
    singleFeeMinor: single.feeMinor,
    plannedFeeMinor: planned,
    savingsMinor: single.feeMinor - planned,
    parts,
  };
}

// ------------------------------ capacity split ----------------------------

export type CapacityResult =
  /** The amount fits in one transfer: no split is offered. */
  | { status: "fits" }
  | { status: "invalid_input" }
  /** More parts than `maxParts` would be needed. */
  | { status: "too_many_parts"; partsNeeded: number }
  | {
    status: "plan";
    capacityMinor: bigint;
    parts: SplitPart[];
    /**
     * Sum of the per-part fee ceiling when one is given. A ceiling, not a
     * prediction: the institution decides the actual charge.
     */
    feeCeilingMinor: bigint | null;
  };

export const DEFAULT_CAPACITY_MAX_PARTS = 10;

/**
 * Split an amount that EXCEEDS a network's per-transaction capacity into the
 * fewest parts that each fit. Parts are as even as possible (the first ones one
 * unit larger when it does not divide), so no part is a tiny remainder. An amount
 * at or below capacity returns "fits": nothing is ever suggested for it.
 */
export function planCapacitySplit(args: {
  totalMinor: bigint;
  capacityMinor: bigint;
  /** Per-part fee ceiling, e.g. eKash's published RWF 20. Null when unknown. */
  feePerPartMinor?: bigint | null;
  maxParts?: number;
}): CapacityResult {
  const { totalMinor, capacityMinor } = args;
  if (totalMinor <= 0n || capacityMinor <= 0n) return { status: "invalid_input" };
  if (totalMinor <= capacityMinor) return { status: "fits" };

  const n = (totalMinor + capacityMinor - 1n) / capacityMinor; // ceil
  const maxParts = args.maxParts ?? DEFAULT_CAPACITY_MAX_PARTS;
  if (n > BigInt(maxParts)) {
    return { status: "too_many_parts", partsNeeded: Number(n) };
  }
  const count = Number(n);
  const base = totalMinor / n;
  const extra = Number(totalMinor % n);
  const fee = args.feePerPartMinor ?? null;
  const parts: SplitPart[] = Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    amountMinor: i < extra ? base + 1n : base,
    feeMinor: fee,
  }));
  return {
    status: "plan",
    capacityMinor,
    parts,
    feeCeilingMinor: fee === null ? null : fee * n,
  };
}

/** True when the parts add back up to the total and none is empty. */
export function partsSumTo(parts: readonly SplitPart[], totalMinor: bigint): boolean {
  if (parts.length === 0) return false;
  let s = 0n;
  for (const p of parts) {
    if (p.amountMinor <= 0n) return false;
    s += p.amountMinor;
  }
  return s === totalMinor;
}
