// Payment requests, Stage 1 (NON-CUSTODIAL). Pure helpers; the database
// (20261225000000_payment_requests.sql) re-validates everything - this module
// is for early UX validation, token handling and QR/link safety, never a
// security boundary. Imports only the pure msisdn normaliser.
//
// Hard rules mirrored from the DB:
//  - the raw token is generated HERE (256 bits) and never sent to or stored by
//    the database; only its SHA-256 hex digest is;
//  - opening a link or a payer's claim never changes status; "paid" exists
//    only as marked_paid_by_owner (owner's assertion) or matched (a human
//    links a real settled incoming transaction).

import { normalizeMsisdn } from "../counterparties/normalize.ts";

export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const SUPPORTED_REQUEST_CURRENCIES = ["RWF", "USD", "EUR"] as const;
export const MAX_AMOUNT_MINOR = 1_000_000_000_000n;
export const MAX_EXPIRY_DAYS = 90;
export const MIN_EXPIRY_MS = 60_000;

/** 256-bit random token, 64 lowercase hex chars. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/** SHA-256 hex digest - the only form of the token the database ever sees. */
export async function hashToken(token: string): Promise<string> {
  if (!isValidToken(token)) throw new Error("invalid token");
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --------------------------- public link / QR ------------------------------

/**
 * The ONLY string a QR code or share link may encode: https://<origin>/r/<token>.
 * `origin` must be a bare https origin (no path/query/credentials).
 */
export function buildPublicUrl(origin: string, token: string): string {
  const o = parseOrigin(origin);
  if (!o) throw new Error("origin must be a bare https origin");
  if (!isValidToken(token)) throw new Error("invalid token");
  return `${o}/r/${token}`;
}

/**
 * Validates a scanned / pasted URL against OUR origin and returns the token,
 * or null. Rejects other hosts (incl. look-alikes and userinfo tricks), http,
 * ports, extra path segments, query strings and fragments - so a tampered QR
 * or an open-redirect style link is never treated as a payment request.
 */
export function parsePublicUrl(
  raw: string,
  allowedOrigin: string,
): string | null {
  const allowed = parseOrigin(allowedOrigin);
  if (!allowed) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.origin !== allowed || u.username || u.password || u.search || u.hash) {
    return null;
  }
  const m = /^\/r\/([0-9a-f]{64})$/.exec(u.pathname);
  return m ? m[1] : null;
}

function parseOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (u.pathname !== "/" || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}

// ------------------------------- validation --------------------------------

export type CreateInput = {
  amountMinor: bigint;
  currency: string;
  destinationType: "momo_phone" | "merchant_code";
  destinationValue: string;
  recipientDisplay: string;
  reference?: string | null;
  expiresAt: Date;
};

export type ValidationError =
  | "invalid_amount"
  | "invalid_currency"
  | "invalid_destination"
  | "invalid_recipient"
  | "invalid_reference"
  | "invalid_expiry";

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Normalised destination, or null when invalid. */
export function normalizeDestination(
  type: CreateInput["destinationType"],
  value: string,
): string | null {
  if (type === "momo_phone") return normalizeMsisdn(value);
  if (type === "merchant_code") {
    return /^[0-9]{4,8}$/.test(value) ? value : null;
  }
  return null;
}

export function validateCreateInput(
  i: CreateInput,
  now: Date,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (i.amountMinor <= 0n || i.amountMinor > MAX_AMOUNT_MINOR) {
    errors.push("invalid_amount");
  }
  if (
    !(SUPPORTED_REQUEST_CURRENCIES as readonly string[]).includes(i.currency)
  ) {
    errors.push("invalid_currency");
  }
  if (normalizeDestination(i.destinationType, i.destinationValue) === null) {
    errors.push("invalid_destination");
  }
  const name = i.recipientDisplay.trim();
  if (name.length < 1 || name.length > 80 || CONTROL.test(name)) {
    errors.push("invalid_recipient");
  }
  const ref = (i.reference ?? "").trim();
  if (ref.length > 64 || CONTROL.test(ref)) errors.push("invalid_reference");
  const t = i.expiresAt.getTime();
  if (
    Number.isNaN(t) || t <= now.getTime() + MIN_EXPIRY_MS ||
    t > now.getTime() + MAX_EXPIRY_DAYS * 86_400_000
  ) {
    errors.push("invalid_expiry");
  }
  return errors;
}

// ------------------------------ state machine ------------------------------

export type StoredStatus =
  | "open"
  | "cancelled"
  | "marked_paid_by_owner"
  | "matched";
export type EffectiveStatus = StoredStatus | "expired";

export function effectiveStatus(
  stored: StoredStatus,
  expiresAt: Date,
  now: Date,
): EffectiveStatus {
  return stored === "open" && expiresAt.getTime() <= now.getTime()
    ? "expired"
    : stored;
}

export type Transition = "cancel" | "mark_paid_by_owner" | "match_transaction";

/** Mirrors _payment_request_for_update: transitions only leave 'open'; paid-ish ones need an unexpired request. */
export function canTransition(
  stored: StoredStatus,
  expiresAt: Date,
  now: Date,
  action: Transition,
): boolean {
  if (stored !== "open") return false;
  if (action === "mark_paid_by_owner") {
    return expiresAt.getTime() > now.getTime();
  }
  return true; // cancel and match are allowed even after expiry (late payment can still be matched)
}

/** What a payer-facing page may say. Never "paid" for anything but the two attested states. */
export function payerFacingLabel(s: EffectiveStatus): string {
  switch (s) {
    case "open":
      return "Awaiting payment - not verified by OneLedger";
    case "expired":
      return "This request has expired";
    case "cancelled":
      return "This request was cancelled";
    case "marked_paid_by_owner":
      return "The requester says this was paid";
    case "matched":
      return "The requester recorded a matching payment";
  }
}
