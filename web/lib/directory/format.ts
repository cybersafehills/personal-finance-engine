import { formatRwf } from "../format";
import type { PublicFee, PublicLimit } from "./public-types";

const nf = new Intl.NumberFormat("en-RW", { style: "decimal", maximumFractionDigits: 0 });

/** minor units → display. RWF has no subunit, so a RWF value is whole RWF. */
export function formatAmountMinor(minor: number | null | undefined, currency: string): string | null {
  if (minor == null) return null;
  if (currency === "RWF") return formatRwf(minor);
  return `${nf.format(minor)} ${currency}`;
}

export function describeFee(fee: PublicFee): string {
  switch (fee.fee_type) {
    case "none":
      return "No fee";
    case "unknown":
      return "Fee not published";
    case "varies_by_institution":
      return "Varies by institution";
    case "published_maximum": {
      const max = formatAmountMinor(fee.max_fee_minor, fee.currency);
      return max ? `Up to ${max} (published maximum)` : "Published maximum (amount not stated)";
    }
    case "percentage": {
      const pct = fee.percentage_bps != null ? `${(fee.percentage_bps / 100).toString()}%` : "a percentage";
      return `${pct} of the amount`;
    }
    case "fixed": {
      const f = formatAmountMinor(fee.fixed_fee_minor, fee.currency);
      return f ? `${f} per transaction` : "A fixed fee";
    }
    case "tiered":
      return "Tiered — depends on the amount";
    default:
      return fee.fee_type;
  }
}

export function describeLimit(limit: PublicLimit): string {
  const parts: string[] = [];
  const max = formatAmountMinor(limit.max_txn_minor, limit.currency);
  const daily = formatAmountMinor(limit.daily_limit_minor, limit.currency);
  const min = formatAmountMinor(limit.min_txn_minor, limit.currency);
  if (min) parts.push(`min ${min}`);
  if (max) parts.push(`max ${max} per transaction${limit.is_published_maximum ? " (published maximum)" : ""}`);
  if (daily) parts.push(`${daily} per day`);
  return parts.join(" · ") || "Not published";
}
