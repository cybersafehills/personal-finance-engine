import { currencyMinorDigits } from "./money";
import { MAX_AMOUNT_MINOR } from "./types";

// Phase R3 - turning a validated verified_ussd scan into a
// payment_intents draft + a hand-off. Pure: string arithmetic for money
// (never parseFloat * 100), and the directory-meta -> intent-payload
// mapping. The server action wires in the real directory row and the
// create_payment_intent RPC.

export type UserAmountResult =
  | { ok: true; minor: number }
  | {
      ok: false;
      reason: "required" | "not_a_number" | "not_positive" | "too_large" | "too_precise";
    };

/**
 * Parse a user-typed MAJOR-unit amount ("5000", "12.50") into exact
 * MINOR units for `currency`. Rejects a wrong-precision or absurd value.
 * No floating-point anywhere.
 */
export function parseUserAmount(input: string, currency: string): UserAmountResult {
  const raw = input.trim().replace(/[,\s]/g, "");
  if (raw === "") return { ok: false, reason: "required" };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, reason: "not_a_number" };

  const digits = currencyMinorDigits(currency);
  const [whole, frac = ""] = raw.split(".");
  if (frac.length > digits) return { ok: false, reason: "too_precise" };

  const minorStr = (whole + frac.padEnd(digits, "0")).replace(/^0+(?=\d)/, "");
  const minor = Number(minorStr);
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: "too_large" };
  if (minor <= 0) return { ok: false, reason: "not_positive" };
  if (minor >= MAX_AMOUNT_MINOR) return { ok: false, reason: "too_large" };
  return { ok: true, minor };
}

export type IntentProvider = "mtn" | "airtel" | "bank" | "other";

/** service_codes.category / .intent -> payment_intents.payment_type. */
export function ussdPaymentType(
  category: string | null,
  intent: string | null,
): string {
  switch (intent) {
    case "send_money":
      return "pay_person";
    case "buy_airtime":
      return "buy_airtime";
    case "pay_bill":
      return "pay_bill";
    case "buy_electricity":
    case "buy_token":
      return "buy_electricity";
    case "pay_merchant":
      return "pay_merchant";
  }
  switch (category) {
    case "airtime_data":
      return "buy_airtime";
    case "utilities":
      return "buy_electricity";
    case "government":
    case "taxes":
      return "government";
    case "banking":
      return "pay_bill";
    case "merchant_payment":
      return "pay_merchant";
    default:
      return "pay_merchant";
  }
}

/** supported_networks / provider label -> payment_intents.provider. */
export function ussdProvider(
  networks: string[],
  providerLabel: string | null,
): IntentProvider {
  const n = networks.map((x) => x.toLowerCase());
  if (n.includes("mtn")) return "mtn";
  if (n.includes("airtel")) return "airtel";
  if (/\bbank\b/.test((providerLabel ?? "").toLowerCase())) return "bank";
  return "other";
}

function recipientKindFor(type: string): string | null {
  switch (type) {
    case "pay_person":
    case "buy_airtime":
      return "phone";
    case "pay_merchant":
      return "merchant";
    case "pay_bill":
      return "biller";
    case "buy_electricity":
      return "meter";
    default:
      return "other";
  }
}

export type ScanIntentPayloadArgs = {
  workspaceId: string;
  idempotencyKey: string;
  serviceCodeId: string;
  paymentType: string;
  provider: IntentProvider;
  amountMinor: number;
  currency: string;
  /** The <kind>-redacted template (never the filled dial string). */
  ussdRedactedTemplate: string;
  category: string | null;
  note: string | null;
  recipientMsisdnNormalized: string | null;
  recipientMsisdnMasked: string | null;
  ttlHours: number;
  sessionFresh: boolean | null;
};

/** The jsonb payload for `create_payment_intent`. Carries `source:
 *  'qr_scan'` and only the fields a scan legitimately produces - never a
 *  filled USSD string, never a PIN. */
export function buildScanIntentPayload(
  a: ScanIntentPayloadArgs,
): Record<string, unknown> {
  return {
    workspace_id: a.workspaceId,
    idempotency_key: a.idempotencyKey,
    source: "qr_scan",
    payment_type: a.paymentType,
    provider: a.provider,
    amount_minor: a.amountMinor,
    currency: a.currency,
    recipient_kind: recipientKindFor(a.paymentType),
    recipient_msisdn_normalized: a.recipientMsisdnNormalized,
    recipient_msisdn_masked: a.recipientMsisdnMasked,
    service_code_id: a.serviceCodeId,
    ussd_string_redacted: a.ussdRedactedTemplate,
    note: a.note,
    category: a.category,
    ttl_hours: a.ttlHours,
    session_fresh: a.sessionFresh,
  };
}

/** `tel:` href for a fully-formed USSD dial string (# -> %23; * and
 *  digits literal) - the combination iOS and Android both dial. The
 *  scanned literal is already complete; nothing is appended. */
export function scanTelHref(dial: string): string {
  return "tel:" + dial.replace(/#/g, "%23");
}
