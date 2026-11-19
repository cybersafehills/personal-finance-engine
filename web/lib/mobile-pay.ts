// Payloads for the mobile app's pay endpoints (POST /api/mobile/pay/intents,
// GET /api/mobile/pay/intents/:id). Pure: reshapes a stored payment intent and
// its (already built) USSD instruction into plain JSON, and validates the
// create request. Zero imports from server-only code so it is `deno test`-able.

import type { FillResult } from "./ussd/capability.ts";
import { buildTelHref } from "./ussd/capability.ts";

/**
 * The intent types the app can create today: the ones with a genuine verified
 * USSD route. Airtime is left out on purpose (the directory resolves
 * `buy_airtime` to the send-money code, which would transfer money rather than
 * buy airtime) and bill payments have no route yet.
 */
export const MOBILE_PAYMENT_TYPES = ["pay_person", "pay_merchant"] as const;
export type MobilePaymentType = (typeof MOBILE_PAYMENT_TYPES)[number];

export type CreateIntentRequest = {
  paymentType: MobilePaymentType;
  amountMinor: number;
  idempotencyKey: string;
  recipientName?: string;
  recipientMsisdn?: string;
  merchantCode?: string;
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
  if (
    recipientName === null || recipientMsisdn === null || merchantCode === null
  ) {
    return { ok: false, message: "One of the recipient details isn't valid." };
  }

  if (paymentType === "pay_person" && !recipientMsisdn) {
    return { ok: false, message: "A phone number is needed for this payment." };
  }
  if (paymentType === "pay_merchant") {
    if (!merchantCode) {
      return {
        ok: false,
        message: "A merchant code is needed for this payment.",
      };
    }
    // A merchant has no phone number to say which network to dial on, so the
    // paying account's own network decides (resolved server-side from the row).
    if (typeof b.sourceAccountId !== "string") {
      return { ok: false, message: "Choose the account you're paying from." };
    }
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
  /** The full normalised number (2507XXXXXXXX): the payer's own payment, shown to the payer. */
  recipient_msisdn_normalized?: string | null;
  merchant_code: string | null;
  billing_reference: string | null;
  expires_at: string | null;
  created_at: string;
  /** Set when the provider's own message matched this payment. */
  verified_at?: string | null;
  /** Set when the user confirmed the payment themselves. */
  manually_confirmed_at?: string | null;
  updated_at?: string | null;
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
  /** The whole number the payment goes to, so the payer can check who they are paying (null for a merchant payment). */
  recipientMsisdn: string | null;
  merchantCode: string | null;
  billingReference: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** When the payment last changed (hand-off time while it waits). */
  updatedAt: string;
  /** A "successful" payment the provider's message confirmed (true), or one the user confirmed (false). */
  verified: boolean;
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
    recipientMsisdn: intent.recipient_msisdn_normalized ?? null,
    merchantCode: intent.merchant_code,
    billingReference: intent.billing_reference,
    expiresAt: intent.expires_at,
    createdAt: intent.created_at,
    updatedAt: intent.updated_at ?? intent.created_at,
    verified: intent.verified_at != null,
    instruction: filled === null ? null : filled.ok
      ? {
        ok: true,
        display: filled.display,
        telHref: buildTelHref(filled.dial),
      }
      : { ok: false, error: filled.error },
  };
}

// ---------------------------------------------------------------------------
// Recording a handoff (POST /api/mobile/pay/intents/:id/handoff)
// ---------------------------------------------------------------------------

/** What the app can honestly report: it opened the dialer, or the user copied/shared the code. */
const HANDOFF_OUTCOMES = {
  dialer: ["dialer_opened", "dialer_unsupported"],
  copy: ["copied", "fallback_shown"],
} as const;

export type HandoffRequest =
  | { method: "dialer"; outcome: (typeof HANDOFF_OUTCOMES.dialer)[number] }
  | { method: "copy"; outcome: (typeof HANDOFF_OUTCOMES.copy)[number] };

export type ParsedHandoff =
  | { ok: true; value: HandoffRequest }
  | { ok: false; message: string };

export function parseHandoff(body: unknown): ParsedHandoff {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Send the handoff details as JSON." };
  }
  const { method, outcome } = body as Record<string, unknown>;
  if (method !== "dialer" && method !== "copy") {
    return { ok: false, message: "That handoff method isn't supported." };
  }
  const allowed: readonly string[] = HANDOFF_OUTCOMES[method];
  if (typeof outcome !== "string" || !allowed.includes(outcome)) {
    return {
      ok: false,
      message: "That handoff outcome isn't valid for the method.",
    };
  }
  return { ok: true, value: { method, outcome } as HandoffRequest };
}

// ---------------------------------------------------------------------------
// Settling a payment yourself (POST /api/mobile/pay/intents/:id/settle)
// ---------------------------------------------------------------------------

/**
 * When no provider message arrives, the person who actually dialled knows: they
 * can confirm they sent it, or say it did not go through. Same two actions as the
 * web's payment page (manually_confirm_payment / transition to "failed"); neither
 * is ever shown as provider-verified.
 */
export type SettleRequest = { outcome: "sent" | "failed" };

export type ParsedSettle =
  | { ok: true; value: SettleRequest }
  | { ok: false; message: string };

export function parseSettle(body: unknown): ParsedSettle {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Send the outcome as JSON." };
  }
  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome !== "sent" && outcome !== "failed") {
    return { ok: false, message: "Say whether it was sent or did not go through." };
  }
  return { ok: true, value: { outcome } };
}

