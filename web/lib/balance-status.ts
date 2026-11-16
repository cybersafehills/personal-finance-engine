// Balance provenance labels (docs/oneledger-3/architecture.md, invariant I7).
// PURE: derives Confirmed / Estimated / Stale / Unavailable from the row
// that account_balance_baselines_v returns. Estimates are computed here and
// never stored, so a derived number can't be mistaken for an observation.
// Zero imports (deno-testable).
//
// Meanings:
//  confirmed   - provider-reported balance, nothing has happened since, and
//                it is not older than the stale threshold.
//  estimated   - a baseline plus later settled, fully classified
//                transactions (or a user-stated baseline with none since).
//                Never "confirmed": only the provider can confirm.
//  stale       - the baseline is older than the threshold, OR something
//                since it prevents a trustworthy estimate (pending/unknown or
//                unclassified activity, or a reconciliation mismatch). The
//                last KNOWN balance is shown with its as-of time, never a
//                projected one.
//  unavailable - no baseline at all. No number is shown.

export type BalanceStatus =
  | "confirmed"
  | "estimated"
  | "stale"
  | "unavailable";

export type BalanceBaselineRow = {
  baseline_amount_minor: number | string | bigint | null;
  baseline_as_of: string | null;
  baseline_source: "provider_reported" | "manual" | null;
  txns_since_count: number | string | bigint;
  net_effect_since_minor: number | string | bigint;
  unresolved_since_count: number | string | bigint;
  mismatch_since_count: number | string | bigint;
};

export type BalanceReason =
  | "no_baseline"
  | "baseline_old"
  | "unresolved_activity"
  | "reconciliation_mismatch"
  | "user_stated_baseline"
  | "activity_since_baseline";

export type DerivedBalance = {
  status: BalanceStatus;
  /** null only when status === "unavailable". */
  amountMinor: bigint | null;
  /** When the figure is true as of (baseline time), not "now". */
  asOf: string | null;
  basis: "provider_reported" | "manual" | null;
  reasons: BalanceReason[];
};

/** Proposed default; owner to confirm after baseline metrics (security.md). */
export const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function big(v: number | string | bigint): bigint {
  return typeof v === "bigint" ? v : BigInt(v);
}

export function deriveBalance(
  row: BalanceBaselineRow,
  now: Date,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): DerivedBalance {
  if (
    row.baseline_amount_minor === null || row.baseline_as_of === null ||
    row.baseline_source === null
  ) {
    return {
      status: "unavailable",
      amountMinor: null,
      asOf: null,
      basis: null,
      reasons: ["no_baseline"],
    };
  }

  const base = big(row.baseline_amount_minor);
  const since = big(row.txns_since_count);
  const unresolved = big(row.unresolved_since_count);
  const mismatches = big(row.mismatch_since_count);
  const ageMs = now.getTime() - new Date(row.baseline_as_of).getTime();
  const basis = row.baseline_source;

  const stale = (reasons: BalanceReason[]): DerivedBalance => ({
    status: "stale",
    amountMinor: base,
    asOf: row.baseline_as_of,
    basis,
    reasons,
  });

  const blockers: BalanceReason[] = [];
  if (unresolved > 0n) blockers.push("unresolved_activity");
  if (mismatches > 0n) blockers.push("reconciliation_mismatch");
  if (ageMs > staleAfterMs) blockers.unshift("baseline_old");
  if (blockers.length > 0) return stale(blockers);

  if (basis === "manual") {
    return {
      status: "estimated",
      amountMinor: base + big(row.net_effect_since_minor),
      asOf: row.baseline_as_of,
      basis,
      reasons: since > 0n
        ? ["user_stated_baseline", "activity_since_baseline"]
        : ["user_stated_baseline"],
    };
  }

  if (since === 0n) {
    return {
      status: "confirmed",
      amountMinor: base,
      asOf: row.baseline_as_of,
      basis,
      reasons: [],
    };
  }
  return {
    status: "estimated",
    amountMinor: base + big(row.net_effect_since_minor),
    asOf: row.baseline_as_of,
    basis,
    reasons: ["activity_since_baseline"],
  };
}
