"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { supabaseServer } from "../../lib/supabase-server";
import { getActiveWorkspaceId } from "../../lib/queries";
import {
  assertAssistedPayEnabled,
  assertPaymentIntentSurfaceEnabled,
  FeatureDisabledError,
  isPaymentTemplatesEnabled,
  isSmsReconciliationEnabled,
  isTrustedRecipientsEnabled,
  paymentIntentTtlHours,
  smsReconciliationMode,
} from "../../lib/pay/gate";
import {
  guessProvider,
  maskMsisdn,
  normalizeRwandaMsisdn,
} from "../../lib/pay/phone";
import { isSessionFresh } from "../../lib/pay/intents";
import { getServiceCodeForPayment } from "../../lib/ussd/queries";
import {
  type ParamSpec,
  redactUssdForAnalytics,
} from "../../lib/ussd/capability";
import { requireMfaForSensitiveAction } from "../../lib/auth/assurance";

export type PayResult = { ok: true } | { ok: false; error: string };
export type PayIntentResult =
  | { ok: true; id: string; existed?: boolean }
  | { ok: false; error: string };

const PAYMENT_TYPES = [
  "pay_person",
  "pay_merchant",
  "pay_bill",
  "buy_electricity",
  "buy_airtime",
  "government",
] as const;
type PaymentType = (typeof PAYMENT_TYPES)[number];

function isPaymentType(v: string): v is PaymentType {
  return (PAYMENT_TYPES as readonly string[]).includes(v);
}

async function ctx() {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getActiveWorkspaceId();
  return { supabase, userId: user?.id ?? null, workspaceId };
}

function mapErr(err: unknown): { ok: false; error: string } {
  if (err instanceof FeatureDisabledError) {
    return {
      ok: false,
      error: "Assisted Quick Pay is turned off for your account.",
    };
  }
  return { ok: false, error: "Something went wrong." };
}

// ---------------------------------------------------------------------------
// Drafts & intents
// ---------------------------------------------------------------------------

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

/**
 * Create a draft payment intent via the Phase N RPC. The RPC generates
 * the idempotency key (or reuses a client-supplied one) and dedupes on
 * (workspace_id, idempotency_key), so a double-submit yields one row.
 * Never charges anything — the result is a `draft`.
 */
export async function createDraftIntent(
  input: DraftInput,
): Promise<PayIntentResult> {
  await requireMfaForSensitiveAction("/pay");
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in to prepare a payment." };
    assertAssistedPayEnabled(workspaceId);
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
      null;

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

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
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
      session_fresh: await isSessionFresh(),
    };

    const { data, error } = await supabase.rpc("create_payment_intent", {
      payload,
    });
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
    revalidatePath("/pay/activity");
    return { ok: true, id: result.id, existed: result.existed };
  } catch (err) {
    return mapErr(err);
  }
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

export async function updateDraftIntent(
  id: string,
  patch: Record<string, unknown>,
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertAssistedPayEnabled(workspaceId);
    const { error } = await supabase.rpc("update_draft_payment_intent", {
      p_id: id,
      patch,
    });
    if (error) {
      if (/not_draft/i.test(error.message)) {
        return { ok: false, error: "This payment is no longer a draft." };
      }
      if (/not_authorized/i.test(error.message)) {
        return { ok: false, error: "You can't edit this payment." };
      }
      return { ok: false, error: "Could not save your changes." };
    }
    revalidatePath(`/pay/${id}`);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/**
 * Record a handoff gesture and move the intent to
 * awaiting_verification. This is a *navigation* event, not a payment —
 * it never claims the payment succeeded.
 */
export async function recordHandoff(
  id: string,
  method: "dialer" | "copy" | "qr",
  outcome:
    | "dialer_opened"
    | "dialer_unsupported"
    | "copied"
    | "qr_shown"
    | "fallback_shown",
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertPaymentIntentSurfaceEnabled(workspaceId);

    await supabase.rpc("record_payment_attempt", {
      p_intent_id: id,
      p_method: method,
      p_outcome: outcome,
    });
    // draft -> initiated -> awaiting_verification. Ignore "invalid_transition"
    // when the intent is already past draft (a second handoff gesture).
    await supabase.rpc("transition_payment_intent", {
      p_id: id,
      p_to_state: "initiated",
      p_reason: null,
      p_evidence: { method },
    });
    await supabase.rpc("transition_payment_intent", {
      p_id: id,
      p_to_state: "awaiting_verification",
      p_reason: null,
      p_evidence: {},
    });

    // Phase 2b: the payment SMS may already have been ingested (the user
    // dialed, paid, and came back before we got here). Best-effort,
    // opt-in, non-fatal. Uses the service-role client because the
    // matcher RPC is service_role-only (system actor) - the single,
    // isolated place an assisted-pay action reaches for it.
    if (isSmsReconciliationEnabled(workspaceId)) {
      try {
        await supabaseServer().rpc("reconcile_payment_intent", {
          p_intent_id: id,
          p_mode: smsReconciliationMode(),
        });
      } catch {
        /* non-fatal */
      }
    }

    revalidatePath(`/pay/${id}`);
    revalidatePath("/pay/activity");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Phase 2b: reconciliation resolution
// ---------------------------------------------------------------------------

export async function applyReconciliation(
  reconciliationId: string,
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertPaymentIntentSurfaceEnabled(workspaceId);
    const { error } = await supabase.rpc("apply_payment_reconciliation", {
      p_id: reconciliationId,
    });
    if (error) {
      if (/not_authorized/i.test(error.message)) {
        return { ok: false, error: "You can't apply this match." };
      }
      if (/not_linkable/i.test(error.message)) {
        return {
          ok: false,
          error: "This match can't be applied from its current state.",
        };
      }
      return { ok: false, error: "Could not apply the match." };
    }
    revalidatePath("/pay/reconciliation");
    revalidatePath("/pay/activity");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function rejectReconciliation(
  reconciliationId: string,
  reason: string,
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertPaymentIntentSurfaceEnabled(workspaceId);
    const { error } = await supabase.rpc("reject_payment_reconciliation", {
      p_id: reconciliationId,
      p_reason: reason.trim().slice(0, 500) || null,
    });
    if (error) {
      if (/not_authorized/i.test(error.message)) {
        return { ok: false, error: "You can't reject this match." };
      }
      return { ok: false, error: "Could not reject the match." };
    }
    revalidatePath("/pay/reconciliation");
    revalidatePath("/pay/activity");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function linkPaymentManually(
  intentId: string,
  transactionId: string,
  reason: string,
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertPaymentIntentSurfaceEnabled(workspaceId);
    const { error } = await supabase.rpc("link_payment_manually", {
      p_intent_id: intentId,
      p_transaction_id: transactionId,
      p_reason: reason.trim().slice(0, 500) || null,
    });
    if (error) {
      if (/not_authorized/i.test(error.message)) {
        return { ok: false, error: "You can't link this payment." };
      }
      if (/transaction_already_linked/i.test(error.message)) {
        return {
          ok: false,
          error: "That transaction is already linked to another payment.",
        };
      }
      if (/not_linkable|cross_workspace/i.test(error.message)) {
        return {
          ok: false,
          error: "This payment can't be linked to that transaction.",
        };
      }
      return { ok: false, error: "Could not link the payment." };
    }
    revalidatePath(`/pay/${intentId}`);
    revalidatePath("/pay/reconciliation");
    revalidatePath("/pay/activity");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function manuallyConfirm(
  id: string,
  note: string,
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertPaymentIntentSurfaceEnabled(workspaceId);
    const { error } = await supabase.rpc("manually_confirm_payment", {
      p_intent_id: id,
      p_note: note.trim().slice(0, 500) || null,
    });
    if (error) {
      if (/not_confirmable/i.test(error.message)) {
        return {
          ok: false,
          error: "This payment can't be confirmed from its current state.",
        };
      }
      return { ok: false, error: "Could not record your confirmation." };
    }
    revalidatePath(`/pay/${id}`);
    revalidatePath("/pay/activity");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function markIntentFailed(
  id: string,
  reason: string,
): Promise<PayResult> {
  return transitionUser(id, "failed", reason);
}

export async function cancelIntent(id: string): Promise<PayResult> {
  return transitionUser(id, "cancelled", "");
}

async function transitionUser(
  id: string,
  toState: string,
  reason: string,
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertPaymentIntentSurfaceEnabled(workspaceId);
    const { error } = await supabase.rpc("transition_payment_intent", {
      p_id: id,
      p_to_state: toState,
      p_reason: reason.trim() || null,
      p_evidence: {},
    });
    if (error) {
      if (/invalid_transition/i.test(error.message)) {
        return {
          ok: false,
          error: "That isn't allowed from this payment's current state.",
        };
      }
      return { ok: false, error: "Could not update the payment." };
    }
    revalidatePath(`/pay/${id}`);
    revalidatePath("/pay/activity");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/**
 * "Pay again" — creates a fresh editable draft prefilled from a prior
 * intent. Never repeats the earlier payment; the user must review and
 * hand off again.
 */
export async function payAgain(
  sourceIntentId: string,
): Promise<PayIntentResult> {
  await requireMfaForSensitiveAction("/pay/activity");
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in first." };
    assertAssistedPayEnabled(workspaceId);

    const { data: src, error } = await supabase
      .from("payment_intents")
      .select(
        "payment_type, provider, source_account_id, amount_minor, recipient_name, recipient_msisdn_normalized, merchant_code, meter_number, billing_reference, government_reference, service_code_id, ussd_string_redacted, note, category, budget_id, trusted_recipient_id",
      )
      .eq("id", sourceIntentId)
      .maybeSingle();
    if (error || !src) {
      return { ok: false, error: "Couldn't find that payment." };
    }

    return createDraftIntent({
      paymentType: src.payment_type,
      provider: src.provider ?? undefined,
      sourceAccountId: src.source_account_id ?? undefined,
      amountMinor: src.amount_minor,
      recipientName: src.recipient_name ?? undefined,
      recipientMsisdn: src.recipient_msisdn_normalized ?? undefined,
      merchantCode: src.merchant_code ?? undefined,
      meterNumber: src.meter_number ?? undefined,
      billingReference: src.billing_reference ?? undefined,
      governmentReference: src.government_reference ?? undefined,
      serviceCodeId: src.service_code_id ?? undefined,
      ussdTemplate: src.ussd_string_redacted ?? undefined,
      note: src.note ?? undefined,
      category: src.category ?? undefined,
      budgetId: src.budget_id ?? undefined,
      trustedRecipientId: src.trusted_recipient_id ?? undefined,
    });
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Trusted recipients
// ---------------------------------------------------------------------------

export type RecipientInput = {
  displayName: string;
  kind: string;
  msisdn?: string;
  merchantCode?: string;
  accountReference?: string;
  provider?: string;
  relationship?: string;
  defaultCategory?: string;
  trustStatus?: "saved" | "trusted_by_user";
};

export async function createTrustedRecipient(
  input: RecipientInput,
): Promise<PayResult> {
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in first." };
    if (!isTrustedRecipientsEnabled(workspaceId)) {
      throw new FeatureDisabledError("trusted_recipients");
    }
    if (!input.displayName.trim()) {
      return { ok: false, error: "Give the recipient a name." };
    }
    const norm = input.msisdn
      ? normalizeRwandaMsisdn(input.msisdn)
      : { normalized: null, display: "" };
    if (input.msisdn && !norm.normalized) {
      return {
        ok: false,
        error: "That doesn't look like a Rwandan mobile number.",
      };
    }
    if (
      !norm.normalized && !input.merchantCode?.trim() &&
      !input.accountReference?.trim()
    ) {
      return {
        ok: false,
        error: "Add a phone number, merchant code, or reference.",
      };
    }

    const { error } = await supabase.from("trusted_recipients").insert({
      workspace_id: workspaceId,
      created_by: userId,
      display_name: input.displayName.trim(),
      kind: input.kind,
      normalized_msisdn: norm.normalized,
      msisdn_display: norm.normalized ? norm.display : null,
      provider: input.provider ?? guessProvider(norm.normalized) ?? null,
      merchant_code: input.merchantCode?.trim() || null,
      account_reference: input.accountReference?.trim() || null,
      relationship: input.relationship?.trim() || null,
      default_category: input.defaultCategory?.trim() || null,
      trust_status: input.trustStatus === "trusted_by_user"
        ? "trusted_by_user"
        : "saved",
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return { ok: false, error: "You've already saved this recipient." };
      }
      return { ok: false, error: "Could not save the recipient." };
    }
    revalidatePath("/pay/recipients");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function updateTrustedRecipient(
  id: string,
  patch: Partial<RecipientInput>,
): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    if (!isTrustedRecipientsEnabled(workspaceId)) {
      throw new FeatureDisabledError("trusted_recipients");
    }
    const update: Record<string, unknown> = {};
    if (patch.displayName !== undefined) {
      update.display_name = patch.displayName.trim();
    }
    if (patch.relationship !== undefined) {
      update.relationship = patch.relationship.trim() || null;
    }
    if (patch.defaultCategory !== undefined) {
      update.default_category = patch.defaultCategory.trim() || null;
    }
    if (patch.trustStatus !== undefined) {
      update.trust_status = patch.trustStatus === "trusted_by_user"
        ? "trusted_by_user"
        : "saved";
    }
    const { error } = await supabase.from("trusted_recipients").update(update)
      .eq("id", id);
    if (error) return { ok: false, error: "Could not update the recipient." };
    revalidatePath("/pay/recipients");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function deleteTrustedRecipient(id: string): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    if (!isTrustedRecipientsEnabled(workspaceId)) {
      throw new FeatureDisabledError("trusted_recipients");
    }
    const { error } = await supabase.from("trusted_recipients").delete().eq(
      "id",
      id,
    );
    if (error) return { ok: false, error: "Could not remove the recipient." };
    revalidatePath("/pay/recipients");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Payment templates
// ---------------------------------------------------------------------------

export type TemplateInput = {
  name: string;
  paymentType: string;
  provider?: string;
  sourceAccountId?: string;
  trustedRecipientId?: string;
  recipientName?: string;
  recipientMsisdn?: string;
  merchantCode?: string;
  meterNumber?: string;
  reference?: string;
  defaultAmountMinor?: number;
  note?: string;
  category?: string;
  budgetId?: string;
  serviceCodeId?: string;
};

export async function createTemplate(input: TemplateInput): Promise<PayResult> {
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in first." };
    if (!isPaymentTemplatesEnabled(workspaceId)) {
      throw new FeatureDisabledError("payment_templates");
    }
    if (!input.name.trim()) {
      return { ok: false, error: "Give the template a name." };
    }
    if (!isPaymentType(input.paymentType)) {
      return { ok: false, error: "Unknown payment type." };
    }
    const norm = input.recipientMsisdn
      ? normalizeRwandaMsisdn(input.recipientMsisdn)
      : { normalized: null, display: "" };

    // Non-secret snapshot only. The DB trigger also rejects pin/otp/etc.
    const recipient_snapshot: Record<string, unknown> = {};
    if (input.recipientName) {
      recipient_snapshot.name = input.recipientName.trim();
    }
    if (norm.normalized) {
      recipient_snapshot.msisdn_masked = maskMsisdn(norm.normalized);
    }
    if (input.merchantCode) {
      recipient_snapshot.merchant_code = input.merchantCode.trim();
    }
    if (input.meterNumber) {
      recipient_snapshot.meter_number = input.meterNumber.trim();
    }
    if (input.reference) recipient_snapshot.reference = input.reference.trim();

    const { error } = await supabase.from("payment_templates").insert({
      workspace_id: workspaceId,
      created_by: userId,
      name: input.name.trim(),
      payment_type: input.paymentType,
      provider: input.provider ?? null,
      source_account_id: input.sourceAccountId ?? null,
      trusted_recipient_id: input.trustedRecipientId ?? null,
      recipient_snapshot,
      default_amount_minor:
        input.defaultAmountMinor && input.defaultAmountMinor > 0
          ? input.defaultAmountMinor
          : null,
      note: input.note?.trim() || null,
      category: input.category?.trim() || null,
      budget_id: input.budgetId ?? null,
      service_code_id: input.serviceCodeId ?? null,
    });
    if (error) {
      if (/payment_secret_forbidden/i.test(error.message)) {
        return {
          ok: false,
          error: "A template can't store a PIN or other secret.",
        };
      }
      return { ok: false, error: "Could not save the template." };
    }
    revalidatePath("/pay/templates");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

export async function deleteTemplate(id: string): Promise<PayResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    if (!isPaymentTemplatesEnabled(workspaceId)) {
      throw new FeatureDisabledError("payment_templates");
    }
    const { error } = await supabase.from("payment_templates").delete().eq(
      "id",
      id,
    );
    if (error) return { ok: false, error: "Could not delete the template." };
    revalidatePath("/pay/templates");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}
