import "server-only";

import { randomUUID } from "node:crypto";
import { getServiceCodeForPayment } from "../ussd/queries";
import { type ParamSpec, redactUssdForAnalytics } from "../ussd/capability";
import { supabaseSession } from "../supabase-session-server";
import { paymentIntentTtlHours } from "./gate";
import {
  guessProvider,
  maskMsisdn,
  normalizeRwandaMsisdn,
  providerNetworkForAccount,
} from "./phone";

// Creating a draft payment intent, shared by the web server action
// (app/pay/assisted-actions.ts, which adds the cookie MFA step-up, the feature
// gate and revalidation) and the mobile API (app/api/mobile/pay/intents, which
// adds the bearer guard). Everything that decides what an intent contains lives
// here once: validation, the published directory service code, and the
// idempotent create_payment_intent RPC (membership-checked, deduped on
// (workspace_id, idempotency_key)). Never charges anything - the result is a
// `draft`. Callers MUST have already checked the gate and the caller's identity.

export type PayIntentResult =
  | { ok: true; id: string; existed?: boolean }
  | { ok: false; error: string };

export const PAYMENT_TYPES = [
  "pay_person",
  "pay_merchant",
  "pay_bill",
  "buy_electricity",
  "buy_airtime",
  "government",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export function isPaymentType(v: string): v is PaymentType {
  return (PAYMENT_TYPES as readonly string[]).includes(v);
}

export type DraftInput = {
  paymentType: string;
  provider?: string;
  sourceAccountId?: string;
  amountMinor: number;
  recipientName?: string;
  recipientMsisdn?: string;
  merchantCode?: string;
  meterNumber?: string;
  billingReference?: string;
  governmentReference?: string;
  serviceCodeId?: string;
  ussdTemplate?: string;
  ussdParamSpecs?: ParamSpec[];
  note?: string;
  category?: string;
  budgetId?: string;
  trustedRecipientId?: string;
  templateId?: string;
  /** Client-held key so a retried submit is a no-op, not a duplicate. */
  idempotencyKey?: string;
};

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

/** The Space that owns `accountId`, or null if unknown / not readable. */
async function workspaceOfAccount(
  supabase: Awaited<ReturnType<typeof supabaseSession>>,
  accountId: string | undefined,
): Promise<string | null> {
  if (!accountId) return null;
  const { data } = await supabase
    .from("accounts")
    .select("workspace_id")
    .eq("id", accountId)
    .maybeSingle();
  return (data?.workspace_id as string | undefined) ?? null;
}

export async function createPaymentIntent(args: {
  supabase: Awaited<ReturnType<typeof supabaseSession>>;
  workspaceId: string | null;
  input: DraftInput;
  /** Advisory "recent sign-in" signal recorded on the intent. */
  sessionFresh: boolean;
  /**
   * The paying account's `provider` (e.g. `mtn_momo`), read server-side. A
   * merchant / bill payment has no recipient number to guess a network from, so
   * the account's own network (the SIM the USSD is dialled on) is the fallback,
   * exactly as the web form does in the browser.
   */
  accountProvider?: string | null;
}): Promise<PayIntentResult> {
  const { supabase, workspaceId, input, sessionFresh, accountProvider } = args;
  if (!isPaymentType(input.paymentType)) {
    return { ok: false, error: "Unknown payment type." };
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }

  const norm = input.recipientMsisdn
    ? normalizeRwandaMsisdn(input.recipientMsisdn)
    : { normalized: null, display: "" };
  if (input.recipientMsisdn && !norm.normalized) {
    return {
      ok: false,
      error: "That doesn't look like a Rwandan mobile number.",
    };
  }

  const providerGuess = input.provider ?? guessProvider(norm.normalized) ??
    providerNetworkForAccount(accountProvider) ?? null;

  // Give the intent a real USSD template to hand off with, resolved
  // from the published directory (never a hard-coded string). Only the
  // redacted template is persisted.
  let serviceCodeId = input.serviceCodeId ?? null;
  let ussdRedacted: string | null = input.ussdTemplate && input.ussdParamSpecs
    ? redactUssdForAnalytics(input.ussdTemplate, input.ussdParamSpecs)
    : (input.ussdTemplate ?? null);
  // Map the payment type onto the published directory `intent` we can
  // hand off with. Without this, a merchant / bill payment never gets a
  // service_code_id and the review screen can only ever say "no
  // verified USSD route" - the concatenated *182*8*1*code*amount# form
  // is generated from the resolved code, never hard-coded here.
  const directoryIntent: string | null =
    input.paymentType === "pay_person" || input.paymentType === "buy_airtime"
      ? "send_money"
      : input.paymentType === "pay_merchant"
        ? "merchant_payment"
        : null;
  if (
    !serviceCodeId &&
    directoryIntent &&
    (providerGuess === "mtn" || providerGuess === "airtel")
  ) {
    const code = await getServiceCodeForPayment(providerGuess, directoryIntent);
    if (code) {
      serviceCodeId = code.id;
      ussdRedacted = redactUssdForAnalytics(
        code.ussd_template,
        code.parameters.map((p) => ({
          key: p.key,
          kind: p.kind,
          required: p.required,
          formatRegex: p.format_regex,
          minLength: p.min_length,
          maxLength: p.max_length,
        })),
      );
    }
  }

  // The intent MUST live in the same Space as the paying account's
  // transactions: the SMS reconciler only matches an intent to a transaction
  // in the SAME workspace. Using the *active* Space instead (e.g. paying from a
  // Household Space while the MoMo account belongs to Personal) saved the intent
  // where its confirming SMS could never be matched, so it waited forever.
  const intentWorkspaceId = await workspaceOfAccount(
    supabase,
    input.sourceAccountId,
  ) ?? workspaceId;

  const payload: Record<string, unknown> = {
    workspace_id: intentWorkspaceId,
    idempotency_key: input.idempotencyKey ?? randomUUID(),
    payment_type: input.paymentType,
    provider: providerGuess,
    source_account_id: input.sourceAccountId ?? null,
    amount_minor: input.amountMinor,
    recipient_kind: recipientKindFor(input.paymentType),
    recipient_name: input.recipientName ?? null,
    recipient_msisdn_normalized: norm.normalized,
    recipient_msisdn_masked: norm.normalized
      ? maskMsisdn(norm.normalized)
      : null,
    merchant_code: input.merchantCode ?? null,
    meter_number: input.meterNumber ?? null,
    billing_reference: input.billingReference ?? null,
    government_reference: input.governmentReference ?? null,
    service_code_id: serviceCodeId,
    ussd_string_redacted: ussdRedacted,
    note: input.note ?? null,
    category: input.category ?? null,
    budget_id: input.budgetId ?? null,
    trusted_recipient_id: input.trustedRecipientId ?? null,
    template_id: input.templateId ?? null,
    ttl_hours: paymentIntentTtlHours(),
    session_fresh: sessionFresh,
  };

  let { data, error } = await supabase.rpc("create_payment_intent", {
    payload,
  });
  if (
    error && /not_authorized/i.test(error.message) &&
    intentWorkspaceId !== workspaceId
  ) {
    // Not a member of the account's Space (e.g. a shared account): fall back
    // to the Space the user is working in rather than failing the payment.
    ({ data, error } = await supabase.rpc("create_payment_intent", {
      payload: { ...payload, workspace_id: workspaceId },
    }));
  }
  if (error) {
    if (/not_authorized/i.test(error.message)) {
      return { ok: false, error: "You're not a member of this workspace." };
    }
    if (/invalid_amount/i.test(error.message)) {
      return { ok: false, error: "Enter a valid amount." };
    }
    return { ok: false, error: "Could not prepare the payment." };
  }
  const result = data as { id: string; existed: boolean };
  return { ok: true, id: result.id, existed: result.existed };
}
