// Maps the resolve_payment_request RPC row to what the public page may show.
// Pure (imports only pure modules). The destination is only ever present
// while the request is open and unexpired - the database withholds it
// otherwise, and this mapper refuses to show one for any other status even if
// a row somehow carried it (defence in depth).

import { formatMoney, isSupportedCurrency } from "../money.ts";
import { normalizeMsisdn } from "../counterparties/normalize.ts";
import { type EffectiveStatus, payerFacingLabel } from "./payment-request.ts";

export type ResolveRow = {
  status: string;
  amount_minor: number | string;
  currency: string;
  recipient_display: string;
  reference: string | null;
  expires_at: string;
  destination_type: string | null;
  destination_value: string | null;
};

export type PublicPaymentRequestView = {
  status: EffectiveStatus;
  statusLabel: string;
  amountText: string;
  /** Whole amount in minor units (RWF has none) and its currency - for building a pay hand-off. */
  amountMinor: string;
  currency: string;
  recipientDisplay: string;
  reference: string | null;
  expiresAt: string;
  /** Present only for an open request. */
  destination:
    | { type: "momo_phone"; display: string; value: string }
    | { type: "merchant_code"; display: string; value: string }
    | null;
};

const STATUSES: readonly EffectiveStatus[] = [
  "open",
  "expired",
  "cancelled",
  "marked_paid_by_owner",
  "matched",
];

/** +250 793 000 439 */
export function formatMsisdn(msisdn: string): string {
  const n = normalizeMsisdn(msisdn);
  return n
    ? `+${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}`
    : msisdn;
}

export function toPublicView(row: ResolveRow): PublicPaymentRequestView | null {
  if (!(STATUSES as readonly string[]).includes(row.status)) return null;
  if (!isSupportedCurrency(row.currency)) return null;
  let amount: bigint;
  try {
    amount = BigInt(row.amount_minor);
  } catch {
    return null;
  }
  if (amount <= 0n) return null;

  const status = row.status as EffectiveStatus;
  let destination: PublicPaymentRequestView["destination"] = null;
  if (status === "open") {
    if (!row.destination_value) return null; // an open request must carry one
    if (
      row.destination_type === "momo_phone" &&
      normalizeMsisdn(row.destination_value)
    ) {
      destination = {
        type: "momo_phone",
        display: formatMsisdn(row.destination_value),
        value: normalizeMsisdn(row.destination_value)!,
      };
    } else if (
      row.destination_type === "merchant_code" &&
      /^[0-9]{4,8}$/.test(row.destination_value)
    ) {
      destination = {
        type: "merchant_code",
        display: row.destination_value,
        value: row.destination_value,
      };
    } else {
      return null; // an open request must carry a valid destination
    }
  }

  return {
    status,
    statusLabel: payerFacingLabel(status),
    amountText: formatMoney(amount, row.currency),
    amountMinor: amount.toString(),
    currency: row.currency,
    recipientDisplay: row.recipient_display,
    reference: row.reference,
    expiresAt: row.expires_at,
    destination,
  };
}

export function isPaymentRequestsEnabled(
  env: { PAYMENT_REQUESTS_ENABLED?: string },
): boolean {
  return env.PAYMENT_REQUESTS_ENABLED === "true";
}
