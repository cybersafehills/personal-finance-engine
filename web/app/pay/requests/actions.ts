"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { siteUrl } from "../../../lib/site-url";
import { requireMfaForSensitiveAction } from "../../../lib/auth/assurance";
import {
  buildPublicUrl,
  generateToken,
  hashToken,
  validateCreateInput,
} from "../../../lib/payment-requests/payment-request";
import {
  friendlyRequestError,
  isAllowedExpiryHours,
  isPaymentRequestsEnabledForWorkspace,
  parseAmountMinor,
} from "../../../lib/payment-requests/owner";

// Owner actions for payment requests (non-custodial). Every action: signed-in
// user, active workspace, opt-in flag + allowlist, all re-checked on the
// server. The database is the authority (RLS + the RPC's own role checks);
// nothing here marks anything "paid" on a payer's behalf.

export type CreateResult =
  | { ok: true; id: string; url: string; replayed: false }
  | { ok: true; id: string; url: null; replayed: true }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

async function ctx() {
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  const workspaceId = await getActiveWorkspaceId();
  const enabled = !!user && isPaymentRequestsEnabledForWorkspace(
    {
      PAYMENT_REQUESTS_ENABLED: process.env.PAYMENT_REQUESTS_ENABLED,
      PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST: process.env.PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST,
    },
    workspaceId,
  );
  return { supabase, workspaceId, enabled };
}

const OFF = { ok: false, error: "Payment requests aren't available for your account." } as const;
const IDEM = /^[A-Za-z0-9-]{8,100}$/;

export async function createPaymentRequestAction(input: {
  amountText: string;
  currency: string;
  destinationType: string;
  destinationValue: string;
  recipientDisplay: string;
  reference: string;
  expiresInHours: number;
  idempotencyKey: string;
}): Promise<CreateResult> {
  await requireMfaForSensitiveAction("/pay/requests/new");
  const { supabase, workspaceId, enabled } = await ctx();
  if (!enabled || !workspaceId) return OFF;

  const amountMinor = parseAmountMinor(input.amountText, input.currency);
  if (amountMinor === null) return { ok: false, error: "Enter an amount greater than zero." };
  if (input.destinationType !== "momo_phone" && input.destinationType !== "merchant_code") {
    return { ok: false, error: "Choose where the money should be sent." };
  }
  if (!isAllowedExpiryHours(input.expiresInHours)) {
    return { ok: false, error: "Choose how long the request stays valid." };
  }
  if (!IDEM.test(input.idempotencyKey)) return { ok: false, error: "Please reload the page and try again." };

  const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
  const errors = validateCreateInput(
    {
      amountMinor,
      currency: input.currency,
      destinationType: input.destinationType,
      destinationValue: input.destinationValue,
      recipientDisplay: input.recipientDisplay,
      reference: input.reference,
      expiresAt,
    },
    new Date(),
  );
  if (errors.length > 0) {
    return { ok: false, error: friendlyRequestError(errors.includes("invalid_destination") ? "invalid_destination" : errors.includes("invalid_expiry") ? "invalid_expiry" : "invalid_payment_request") };
  }

  let origin: string;
  try {
    origin = new URL(siteUrl()).origin;
    buildPublicUrl(origin, "0".repeat(64)); // fails unless a bare https origin
  } catch {
    return { ok: false, error: "Sharing links isn't configured yet (SITE_URL must be an https address)." };
  }

  // A double-submit with the same key returns the original request. The token
  // exists only in this process and the one response, so it can't be re-shown.
  const { data: existing } = await supabase
    .from("payment_requests")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id, url: null, replayed: true };

  const token = generateToken();
  const { data, error } = await supabase.rpc("create_payment_request", {
    p_workspace_id: workspaceId,
    p_amount_minor: amountMinor.toString(),
    p_currency: input.currency,
    p_destination_type: input.destinationType,
    p_destination_value: input.destinationValue,
    p_recipient_display: input.recipientDisplay,
    p_reference: input.reference.trim() === "" ? null : input.reference,
    p_expires_at: expiresAt.toISOString(),
    p_token_hash: await hashToken(token),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error || typeof data !== "string") {
    return { ok: false, error: friendlyRequestError(error?.message) };
  }
  revalidatePath("/pay/requests");
  return { ok: true, id: data, url: buildPublicUrl(origin, token), replayed: false };
}

async function simple(
  fn: (c: Awaited<ReturnType<typeof ctx>>) => PromiseLike<{ error: { message: string } | null }>,
  id: string,
): Promise<ActionResult> {
  const c = await ctx();
  if (!c.enabled) return OFF;
  const { error } = await fn(c);
  if (error) return { ok: false, error: friendlyRequestError(error.message) };
  revalidatePath("/pay/requests");
  revalidatePath(`/pay/requests/${id}`);
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function cancelPaymentRequestAction(id: string): Promise<ActionResult> {
  if (!UUID.test(id)) return { ok: false, error: "That request couldn't be found." };
  return simple((c) => c.supabase.rpc("cancel_payment_request", { p_id: id }), id);
}

export async function markPaymentRequestPaidAction(id: string, note: string): Promise<ActionResult> {
  if (!UUID.test(id)) return { ok: false, error: "That request couldn't be found." };
  await requireMfaForSensitiveAction(`/pay/requests/${id}`);
  return simple(
    (c) => c.supabase.rpc("mark_payment_request_paid_by_owner", { p_id: id, p_note: note.slice(0, 200) }),
    id,
  );
}

export async function linkPaymentRequestTransactionAction(id: string, transactionId: string): Promise<ActionResult> {
  if (!UUID.test(id) || !UUID.test(transactionId)) return { ok: false, error: "That request couldn't be found." };
  await requireMfaForSensitiveAction(`/pay/requests/${id}`);
  return simple(
    (c) => c.supabase.rpc("link_payment_request_transaction", { p_id: id, p_transaction_id: transactionId }),
    id,
  );
}
