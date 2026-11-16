// Payloads for the mobile app's pay endpoints (POST /api/mobile/pay/intents,
// GET /api/mobile/pay/intents/:id). Pure: reshapes a stored payment intent and
// its (already built) USSD instruction into plain JSON, and validates the
// create request. Zero imports from server-only code so it is `deno test`-able.

import type { FillResult } from "./ussd/capability.ts";
import { buildTelHref } from "./ussd/capability.ts";

/** The intent types the app can create today: the four "Pay X again" targets. */
export const MOBILE_PAYMENT_TYPES = [
  "pay_person",
  "buy_airtime",
  "pay_merchant",
  "pay_bill",
] as const;
export type MobilePaymentType = (typeof MOBILE_PAYMENT_TYPES)[number];

export type CreateIntentRequest = {
  paymentType: MobilePaymentType;
  amountMinor: number;
  idempotencyKey: string;
  recipientName?: string;
  recipientMsisdn?: string;
  merchantCode?: string;
  billingReference?: string;
  sourceAccountId?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_MINOR = 999_999_999; // the amount kind allows up to 9 digits

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v);

const optionalText = (v: unknown, max: number): string | undefined | null => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};

export type ParsedCreate =
  | { ok: true; value: CreateIntentRequest }
  | { ok: false; message: string };

/**
 * Validates the create body. Only fields the app sends are accepted (no note,
 * category, budget or trusted-recipient ids in this slice), and the fields that
 * identify the recipient must match the payment type, like the web form.
 */
export function parseCreateIntent(body: unknown): ParsedCreate {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Send the payment details as JSON." };
  }
  const b = body as Record<string, unknown>;

  if (
    typeof b.paymentType !== "string" ||
    !(MOBILE_PAYMENT_TYPES as readonly string[]).includes(b.paymentType)
  ) {
    return {
      ok: false,
      message: "That payment type isn't supported in the app.",
    };
  }
  const paymentType = b.paymentType as MobilePaymentType;

  if (
    typeof b.amountMinor !== "number" || !Number.isInteger(b.amountMinor) ||
    b.amountMinor <= 0 || b.amountMinor > MAX_AMOUNT_MINOR
  ) {
    return { ok: false, message: "Enter an amount greater than zero." };
  }
  if (!isUuid(b.idempotencyKey)) {
    return { ok: false, message: "A request id is required." };
  }
  if (
    b.sourceAccountId !== undefined && b.sourceAccountId !== null &&
    !isUuid(b.sourceAccountId)
  ) {
    return { ok: false, message: "That account isn't valid." };
  }

  const recipientName = optionalText(b.recipientName, 80);
  const recipientMsisdn = optionalText(b.recipientMsisdn, 20);
  const merchantCode = optionalText(b.merchantCode, 12);
  const billingReference = optionalText(b.billingReference, 40);
  if (
    recipientName === null || recipientMsisdn === null ||
    merchantCode === null || billingReference === null
  ) {
    return { ok: false, message: "One of the recipient details isn't valid." };
  }

  const needsPhone = paymentType === "pay_person" ||
    paymentType === "buy_airtime";
  if (needsPhone && !recipientMsisdn) {
    return { ok: false, message: "A phone number is needed for this payment." };
  }
  if (paymentType === "pay_merchant" && !merchantCode) {
    return {
      ok: false,
      message: "A merchant code is needed for this payment.",
    };
  }
  if (paymentType === "pay_bill" && !billingReference) {
    return {
      ok: false,
      message: "A bill reference is needed for this payment.",
    };
  }

  return {
    ok: true,
    value: {
      paymentType,
      amountMinor: b.amountMinor,
      idempotencyKey: b.idempotencyKey,
      recipientName,
      recipientMsisdn,
      merchantCode,
      billingReference,
      sourceAccountId: typeof b.sourceAccountId === "string"
        ? b.sourceAccountId
        : undefined,
    },
  };
}

export type IntentInput = {
  id: string;
  state: string;
  payment_type: string;
  provider: string | null;
  currency: string;
  amount_minor: number;
  recipient_name: string | null;
  recipient_msisdn_masked: string | null;
  merchant_code: string | null;
  billing_reference: string | null;
  expires_at: string | null;
  created_at: string;
};

export type MobileInstruction =
  | { ok: true; display: string; telHref: string }
  | { ok: false; error: string };

export type MobileIntent = {
  id: string;
  state: string;
  paymentType: string;
  provider: string | null;
  currency: string;
  amountMinor: number;
  recipientName: string | null;
  recipientMasked: string | null;
  merchantCode: string | null;
  billingReference: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** null = no verified USSD route for this payment (the app says so). */
  instruction: MobileInstruction | null;
};

export function toMobileIntent(
  intent: IntentInput,
  filled: FillResult | null,
): MobileIntent {
  return {
    id: intent.id,
    state: intent.state,
    paymentType: intent.payment_type,
    provider: intent.provider,
    currency: intent.currency,
    amountMinor: intent.amount_minor,
    recipientName: intent.recipient_name,
    recipientMasked: intent.recipient_msisdn_masked,
    merchantCode: intent.merchant_code,
    billingReference: intent.billing_reference,
    expiresAt: intent.expires_at,
    createdAt: intent.created_at,
    instruction: filled === null ? null : filled.ok
      ? {
        ok: true,
        display: filled.display,
        telHref: buildTelHref(filled.dial),
      }
      : { ok: false, error: filled.error },
  };
}
