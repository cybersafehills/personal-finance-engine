import { toMinorUnits, type SupportedCurrency } from "@/lib/money";

import type { PaymentRequest, RequestStatus } from "./types";

// Input helpers for creating a payment request. The server (and database)
// re-validate everything; this is for early, friendly feedback only.

export const EXPIRY_CHOICES = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 2160, label: "90 days" },
] as const;

export const CURRENCIES: readonly SupportedCurrency[] = ["RWF", "USD", "EUR"];

/** Typed amount -> minor units, or null when not a positive plain decimal. */
export function parseAmount(text: string, currency: SupportedCurrency): bigint | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  try {
    const v = toMinorUnits(cleaned, currency);
    return v > BigInt(0) ? v : null;
  } catch {
    return null;
  }
}

/** Rwandan mobile number in any common format -> 2507XXXXXXXX, else null. Same rule as the server. */
export function normalizeMsisdn(raw: string): string | null {
  if (raw.includes("*")) return null;
  const v = raw.replace(/[^0-9]/g, "");
  if (/^2507[0-9]{8}$/.test(v)) return v;
  if (/^002507[0-9]{8}$/.test(v)) return v.slice(2);
  if (/^07[0-9]{8}$/.test(v)) return `250${v.slice(1)}`;
  if (/^7[0-9]{8}$/.test(v)) return `250${v}`;
  return null;
}

export type CreateInput = {
  amountText: string;
  currency: SupportedCurrency;
  destinationType: "momo_phone" | "merchant_code";
  destination: string;
  name: string;
  reference: string;
  expiresInHours: number;
};

export type FieldErrors = Partial<Record<"amount" | "destination" | "name" | "reference", string>>;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function validateInput(i: CreateInput): FieldErrors {
  const e: FieldErrors = {};
  if (parseAmount(i.amountText, i.currency) === null) e.amount = "Enter an amount greater than zero.";
  const ok = i.destinationType === "momo_phone" ? normalizeMsisdn(i.destination) !== null : /^[0-9]{4,8}$/.test(i.destination.trim());
  if (!ok) {
    e.destination =
      i.destinationType === "momo_phone"
        ? "Enter a Rwandan mobile number, like 0788 123 456."
        : "Enter a merchant code of 4 to 8 digits.";
  }
  const name = i.name.trim();
  if (name.length < 1 || name.length > 80 || CONTROL.test(name)) e.name = "Enter the name the payer should see.";
  if (i.reference.trim().length > 64 || CONTROL.test(i.reference)) e.reference = "Keep the reference under 64 characters.";
  return e;
}

/** The exact JSON the server expects (amount as a digit string, never a float). */
export function buildCreateBody(i: CreateInput, idempotencyKey: string): Record<string, unknown> | null {
  const amount = parseAmount(i.amountText, i.currency);
  if (amount === null) return null;
  return {
    amount_minor: amount.toString(),
    currency: i.currency,
    destination_type: i.destinationType,
    destination_value: i.destination.trim(),
    recipient_display: i.name.trim(),
    reference: i.reference.trim() === "" ? null : i.reference.trim(),
    expires_in_hours: i.expiresInHours,
    idempotency_key: idempotencyKey,
  };
}

/** A fresh idempotency key: 32 hex characters. */
export function newIdempotencyKey(random: (n: number) => Uint8Array): string {
  return Array.from(random(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------- presentation ----------------------------

export function statusBadge(status: RequestStatus): { label: string; variant: "neutral" | "attention" | "positive" | "accent" } {
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
  }
}

/** "+250 793 000 439" for a stored number; merchant codes unchanged. */
export function destinationText(r: Pick<PaymentRequest, "destinationType" | "destinationValue">): string {
  if (r.destinationType !== "momo_phone") return r.destinationValue;
  const n = r.destinationValue;
  return /^2507[0-9]{8}$/.test(n) ? `+${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}` : n;
}

/** The text sent with the link. Claims nothing about verification or payment. */
export function shareMessage(o: { amountText: string; name: string; url: string }): string {
  return `Payment request for ${o.amountText} from ${o.name}: ${o.url}`;
}

/** Only a link of exactly this shape may be shared: https, our host, /r/<64 hex>. */
export function isShareableLink(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/r\/[0-9a-f]{64}$/.test(url);
}

const ERRORS: readonly (readonly [RegExp, string])[] = [
  [/rate_limited/, "You've created a lot of requests in the last hour. Please wait a bit and try again."],
  [/too_many_open_requests/, "You have too many open requests. Cancel some before creating more."],
  [/payment_request_expired/, "This request has already expired."],
  [/invalid_state_transition/, "This request can no longer be changed."],
  [/transaction_does_not_match/, "That isn't a settled, incoming payment of exactly this amount."],
  [/transaction_already_linked/, "That payment is already linked to another request."],
  [/not_found/, "That request couldn't be found."],
];

/** A fixed sentence for each database refusal; never raw text. */
export function friendlyRequestError(raw: string | null | undefined): string {
  const s = raw ?? "";
  for (const [re, msg] of ERRORS) if (re.test(s)) return msg;
  return "Something went wrong. Please try again.";
}
