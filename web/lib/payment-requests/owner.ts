// Pure helpers for the OWNER-facing payment-request screens: enablement,
// error mapping, amount parsing, share text. No I/O. (The database and
// payment-request.ts remain the authority on validation; this is UX glue.)

import { formatMoney, isSupportedCurrency, toMinorUnits } from "../money.ts";

// ------------------------------- enablement --------------------------------

export type PaymentRequestsEnv = {
  PAYMENT_REQUESTS_ENABLED?: string;
  PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST?: string;
};

/**
 * Creation/management is on only when PAYMENT_REQUESTS_ENABLED is exactly
 * "true" AND, if PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST is non-empty, the
 * workspace is listed. (Opt-in, like SCAN_TO_PAY_ENABLED - unlike the older
 * pay flags that default on.) The public /r page only checks the global flag
 * so links already shared keep resolving.
 */
export function isPaymentRequestsEnabledForWorkspace(
  env: PaymentRequestsEnv,
  workspaceId: string | null,
): boolean {
  if (env.PAYMENT_REQUESTS_ENABLED !== "true") return false;
  const raw = env.PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  const allow = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allow.length === 0 || allow.includes(workspaceId);
}

// ------------------------------ error mapping ------------------------------

const ERRORS: ReadonlyArray<[RegExp, string]> = [
  [
    /rate_limited/,
    "You've created a lot of requests in the last hour. Please wait a bit and try again.",
  ],
  [
    /too_many_open_requests/,
    "This workspace has too many open requests. Cancel some before creating more.",
  ],
  [
    /invalid_expiry/,
    "Choose an expiry between a few minutes and 90 days from now.",
  ],
  [
    /invalid_destination/,
    "Enter a valid Rwandan mobile number (e.g. 0788 123 456) or a 4–8 digit merchant code.",
  ],
  [
    /invalid_payment_request/,
    "Check the amount, currency and name, and try again.",
  ],
  [/payment_request_expired/, "This request has already expired."],
  [/invalid_state_transition/, "This request can no longer be changed."],
  [
    /transaction_does_not_match/,
    "That transaction isn't a settled, incoming payment of exactly this amount.",
  ],
  [
    /transaction_already_linked/,
    "That transaction is already linked to another request.",
  ],
  [
    /transaction_not_found/,
    "That transaction couldn't be found in this workspace.",
  ],
  [
    /payment_request_not_found|workspace_not_found/,
    "That request couldn't be found.",
  ],
  [/not_authenticated/, "Please sign in again."],
  [/duplicate key|23505/, "Couldn't create the link - please try again."],
];

/** A safe, human message for an RPC failure. Never echoes raw database text. */
export function friendlyRequestError(raw: string | null | undefined): string {
  const s = raw ?? "";
  for (const [re, msg] of ERRORS) if (re.test(s)) return msg;
  return "Something went wrong. Please try again.";
}

// ------------------------------ amount parsing -----------------------------

/** Typed amount -> integer minor units, or null when not a positive plain decimal. */
export function parseAmountMinor(
  text: string,
  currency: string,
): bigint | null {
  if (!isSupportedCurrency(currency)) return null;
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  try {
    const v = toMinorUnits(cleaned, currency);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export const EXPIRY_CHOICES_HOURS = [24, 72, 168, 720, 2160] as const;
export function isAllowedExpiryHours(h: number): boolean {
  return (EXPIRY_CHOICES_HOURS as readonly number[]).includes(h);
}

// -------------------------------- share text -------------------------------

/** A short, honest message to send with the link. No claim that anything is verified. */
export function buildShareMessage(o: {
  amountMinor: bigint;
  currency: string;
  recipientDisplay: string;
  url: string;
}): string {
  const amount = isSupportedCurrency(o.currency)
    ? formatMoney(o.amountMinor, o.currency)
    : `${o.amountMinor} ${o.currency}`;
  return `Payment request for ${amount} from ${o.recipientDisplay}: ${o.url}`;
}

// ------------------------------ presentation -------------------------------

export function statusBadge(
  status: string,
): { label: string; variant: "neutral" | "attention" | "positive" | "accent" } {
  switch (status) {
    case "open":
      return { label: "Open", variant: "accent" };
    case "expired":
      return { label: "Expired", variant: "neutral" };
    case "cancelled":
      return { label: "Cancelled", variant: "neutral" };
    case "marked_paid_by_owner":
      return { label: "Marked paid by you", variant: "attention" };
    case "matched":
      return { label: "Matched to a payment", variant: "positive" };
    default:
      return { label: status, variant: "neutral" };
  }
}
