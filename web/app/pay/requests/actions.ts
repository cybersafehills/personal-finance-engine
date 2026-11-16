"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { requireMfaForSensitiveAction } from "../../../lib/auth/assurance";
import {
  type CreateResult,
  createPaymentRequestCore,
} from "../../../lib/payment-requests/create";
import {
  friendlyRequestError,
  isPaymentRequestsEnabledForWorkspace,
  parseAmountMinor,
} from "../../../lib/payment-requests/owner";

// Owner actions for payment requests (non-custodial). Every action: signed-in
// user, active workspace, opt-in flag + allowlist, all re-checked on the
// server. The database is the authority (RLS + the RPC's own role checks);
// nothing here marks anything "paid" on a payer's behalf.

export type { CreateResult };
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

  const res = await createPaymentRequestCore({
    supabase,
    workspaceId,
    amountMinor,
    currency: input.currency,
    destinationType: input.destinationType,
    destinationValue: input.destinationValue,
    recipientDisplay: input.recipientDisplay,
    reference: input.reference,
    expiresInHours: input.expiresInHours,
    idempotencyKey: input.idempotencyKey,
  });
  if (res.ok) revalidatePath("/pay/requests");
  return res;
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
