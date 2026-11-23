"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import {
  assertPaySplitsEnabled,
  FeatureDisabledError,
  isPaymentNetworksEnabled,
  isPaySplitsEnabled,
} from "../../../lib/pay/gate";
import {
  createPaymentIntent,
  type DraftInput,
  type PayIntentResult,
} from "../../../lib/pay/create-intent";
import { isSessionFresh } from "../../../lib/pay/intents";
import { requireMfaForSensitiveAction } from "../../../lib/auth/assurance";
import {
  getSplitOffer,
  type SplitOffer,
  type SplitOfferInput,
} from "../../../lib/pay/splits/offer";
import {
  getSplitPlan,
  nextPartStatus,
  type SplitPartRow,
} from "../../../lib/pay/splits/plans";
import {
  isSplitThreshold,
  type SplitThreshold,
} from "../../../lib/pay/splits/split-math";

export type SplitResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

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
    return { ok: false, error: "Splits are not turned on for your account." };
  }
  return { ok: false, error: "Something went wrong." };
}

function rpcMessage(message: string): string {
  if (/not_authorized/i.test(message)) return "You're not a member of this workspace.";
  if (/not_over_capacity/i.test(message)) return "This amount fits in one transfer, so it isn't split.";
  if (/part_over_capacity/i.test(message)) return "A part is above the network's limit.";
  if (/previous_part_not_settled/i.test(message)) {
    return "Finish the previous part first: confirm that it went through.";
  }
  if (/plan_stopped/i.test(message)) return "This split was stopped.";
  if (/amount_mismatch/i.test(message)) return "That part's amount doesn't match the plan.";
  return "Could not update the split.";
}

/** The Space that owns `accountId`, plus its provider and currency, or nulls. */
async function accountFacts(
  supabase: Awaited<ReturnType<typeof supabaseSession>>,
  accountId: string | undefined,
) {
  if (!accountId) return { workspaceId: null, provider: null, currency: "RWF" };
  const { data } = await supabase
    .from("accounts")
    .select("workspace_id, provider, currency")
    .eq("id", accountId)
    .maybeSingle();
  return {
    workspaceId: (data?.workspace_id as string | undefined) ?? null,
    provider: (data?.provider as string | undefined) ?? null,
    currency: (data?.currency as string | undefined) ?? "RWF",
  };
}

// ---------------------------------------------------------------------------
// Ask: is there a split to suggest for this amount? (read-only)
// ---------------------------------------------------------------------------

export type OfferQuery = {
  paymentType: string;
  /** "ekash" when the user chose to pay over eKash. */
  networkSlug?: string | null;
  sourceAccountId?: string;
  recipientMsisdn?: string;
  amountMinor: number;
};

export async function getSplitOfferAction(
  q: OfferQuery,
): Promise<SplitResult<{ offer: SplitOffer | null }>> {
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in to prepare a payment." };
    if (!isPaySplitsEnabled(workspaceId)) return { ok: true, offer: null };
    const acct = await accountFacts(supabase, q.sourceAccountId);
    const input: SplitOfferInput = {
      paymentType: q.paymentType,
      networkSlug: q.networkSlug ?? null,
      accountProvider: acct.provider,
      recipientMsisdn: q.recipientMsisdn ?? null,
      amountMinor: q.amountMinor,
      currency: acct.currency,
    };
    const offer = await getSplitOffer({
      supabase,
      userId,
      paymentNetworksEnabled: isPaymentNetworksEnabled(workspaceId),
      input,
    });
    return { ok: true, offer };
  } catch {
    // A suggestion is never worth failing the form for.
    return { ok: true, offer: null };
  }
}

// ---------------------------------------------------------------------------
// Start: create the plan and part 1 (a normal draft intent)
// ---------------------------------------------------------------------------

export type StartSplitInput = DraftInput & {
  networkSlug?: string | null;
  /** Client key for this form, so a double-submit is one plan. */
  idempotencyKey: string;
};

export async function startSplitAction(
  input: StartSplitInput,
): Promise<SplitResult<{ planId: string; intentId: string }>> {
  await requireMfaForSensitiveAction("/pay");
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in to prepare a payment." };
    assertPaySplitsEnabled(workspaceId);
    if (!input.idempotencyKey) return { ok: false, error: "Missing request key." };

    const acct = await accountFacts(supabase, input.sourceAccountId);
    // Never trust the parts from the browser: recompute the offer here.
    const offer = await getSplitOffer({
      supabase,
      userId,
      paymentNetworksEnabled: isPaymentNetworksEnabled(workspaceId),
      input: {
        paymentType: input.paymentType,
        networkSlug: input.networkSlug ?? null,
        accountProvider: acct.provider,
        recipientMsisdn: input.recipientMsisdn ?? null,
        amountMinor: input.amountMinor,
        currency: acct.currency,
      },
    });
    if (!offer) {
      return { ok: false, error: "No split is available for this payment." };
    }

    const intentWorkspaceId = acct.workspaceId ?? workspaceId;
    const { data: plan, error: planErr } = await supabase.rpc("create_payment_split_plan", {
      payload: {
        workspace_id: intentWorkspaceId,
        idempotency_key: `plan:${input.idempotencyKey}`,
        kind: offer.kind,
        network_slug: offer.networkSlug,
        payment_type: input.paymentType,
        currency: offer.currency,
        total_amount_minor: offer.totalMinor,
        planned_parts: offer.parts.map((p) => p.amountMinor),
        single_fee_minor: offer.singleFeeMinor,
        planned_fee_minor: offer.plannedFeeMinor,
        fee_basis: offer.feeBasis,
        threshold: offer.threshold,
      },
    });
    if (planErr) return { ok: false, error: rpcMessage(planErr.message) };
    const planId = (plan as { id: string }).id;

    const first = await createPaymentIntent({
      supabase,
      workspaceId,
      input: {
        ...input,
        amountMinor: Number(offer.parts[0].amountMinor),
        idempotencyKey: `plan:${input.idempotencyKey}:1`,
      },
      sessionFresh: await isSessionFresh(),
      accountProvider: acct.provider,
    });
    if (!first.ok) return first;

    const { error: attachErr } = await supabase.rpc("attach_intent_to_split_plan", {
      p_plan: planId,
      p_intent: first.id,
      p_index: 1,
    });
    // A retry returns the same intent, already attached: that is fine.
    if (attachErr && !/intent_not_attachable/i.test(attachErr.message)) {
      return { ok: false, error: rpcMessage(attachErr.message) };
    }

    revalidatePath("/pay/activity");
    return { ok: true, planId, intentId: first.id };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Next part / stop / send the rest as one
// ---------------------------------------------------------------------------

function draftFromPart(first: SplitPartRow, amountMinor: number, key: string): DraftInput {
  return {
    paymentType: first.payment_type,
    provider: first.provider ?? undefined,
    sourceAccountId: first.source_account_id ?? undefined,
    amountMinor,
    recipientName: first.recipient_name ?? undefined,
    recipientMsisdn: first.recipient_msisdn_normalized ?? undefined,
    merchantCode: first.merchant_code ?? undefined,
    note: first.note ?? undefined,
    category: first.category ?? undefined,
    budgetId: first.budget_id ?? undefined,
    trustedRecipientId: first.trusted_recipient_id ?? undefined,
    idempotencyKey: key,
  };
}

/** Prepare the next part, but only once the previous one is settled. */
export async function startNextSplitPartAction(
  planId: string,
): Promise<SplitResult<{ intentId: string; index: number }>> {
  await requireMfaForSensitiveAction("/pay");
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in to prepare a payment." };
    assertPaySplitsEnabled(workspaceId);

    const loaded = await getSplitPlan(planId);
    if (!loaded) return { ok: false, error: "That split was not found." };
    const { plan, parts } = loaded;
    const first = parts.find((p) => p.split_index === 1);
    if (!first) return { ok: false, error: "That split has no first part." };

    const next = nextPartStatus(plan, parts);
    if (next.status === "stopped") return { ok: false, error: "This split was stopped." };
    if (next.status === "complete") return { ok: false, error: "Every part is already prepared." };
    if (next.status === "blocked") {
      return { ok: false, error: "The last part didn't go through. Stop this split or contact your provider." };
    }
    if (next.status === "waiting") {
      return { ok: false, error: "Finish the previous part first: confirm that it went through." };
    }

    const created: PayIntentResult = await createPaymentIntent({
      supabase,
      workspaceId: plan.workspace_id,
      input: draftFromPart(first, Number(next.amountMinor), `plan:${planId}:${next.index}`),
      sessionFresh: await isSessionFresh(),
      accountProvider: first.provider,
    });
    if (!created.ok) return created;

    const { error } = await supabase.rpc("attach_intent_to_split_plan", {
      p_plan: planId,
      p_intent: created.id,
      p_index: next.index,
    });
    if (error && !/intent_not_attachable/i.test(error.message)) {
      return { ok: false, error: rpcMessage(error.message) };
    }
    revalidatePath(`/pay/${created.id}`);
    revalidatePath("/pay/activity");
    return { ok: true, intentId: created.id, index: next.index };
  } catch (err) {
    return mapErr(err);
  }
}

/** Stop the split: no more parts, and any unsent draft part is cancelled. */
export async function stopSplitPlanAction(planId: string): Promise<SplitResult> {
  try {
    const { supabase, workspaceId } = await ctx();
    assertPaySplitsEnabled(workspaceId);
    const { error } = await supabase.rpc("stop_payment_split_plan", { p_plan: planId });
    if (error) return { ok: false, error: rpcMessage(error.message) };
    revalidatePath("/pay/activity");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

/**
 * Fee-saving plans only: stop, and prepare what is left as ONE transfer. Not
 * offered for a capacity plan, whose total cannot go as one transfer by definition.
 * Requires every part already prepared to be settled, so the remainder is unambiguous.
 */
export async function sendRemainingAsOneAction(
  planId: string,
): Promise<SplitResult<{ intentId: string }>> {
  await requireMfaForSensitiveAction("/pay");
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in to prepare a payment." };
    assertPaySplitsEnabled(workspaceId);

    const loaded = await getSplitPlan(planId);
    if (!loaded) return { ok: false, error: "That split was not found." };
    const { plan, parts } = loaded;
    if (plan.kind !== "fee_saving") {
      return { ok: false, error: "This amount can't be sent as one transfer." };
    }
    if (plan.stopped_at) return { ok: false, error: "This split was stopped." };
    const live = parts.filter((p) => p.state !== "cancelled");
    const first = live.find((p) => p.split_index === 1);
    if (!first) return { ok: false, error: "That split has no first part." };
    if (live.some((p) => p.state !== "successful")) {
      return { ok: false, error: "Finish the part in progress first: confirm that it went through." };
    }
    const sent = live.reduce((sum, p) => sum + BigInt(p.amount_minor), 0n);
    const remaining = BigInt(plan.total_amount_minor) - sent;
    if (remaining <= 0n) return { ok: false, error: "Nothing is left to send." };

    const stopped = await supabase.rpc("stop_payment_split_plan", { p_plan: planId });
    if (stopped.error) return { ok: false, error: rpcMessage(stopped.error.message) };

    const created = await createPaymentIntent({
      supabase,
      workspaceId: plan.workspace_id,
      input: draftFromPart(first, Number(remaining), `plan:${planId}:remainder`),
      sessionFresh: await isSessionFresh(),
      accountProvider: first.provider,
    });
    if (!created.ok) return created;
    revalidatePath(`/pay/${created.id}`);
    revalidatePath("/pay/activity");
    return { ok: true, intentId: created.id };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Preferences (fee-saving suggestions: off until the user turns them on)
// ---------------------------------------------------------------------------

export async function setSplitPreferencesAction(args: {
  feeSavingEnabled: boolean;
  threshold: string;
}): Promise<SplitResult> {
  try {
    const { supabase, userId, workspaceId } = await ctx();
    if (!userId) return { ok: false, error: "Sign in first." };
    assertPaySplitsEnabled(workspaceId);
    if (!isSplitThreshold(args.threshold)) return { ok: false, error: "Pick one of the options." };
    const threshold: SplitThreshold = args.threshold;
    const { error } = await supabase.from("pay_split_preferences").upsert(
      {
        user_id: userId,
        fee_saving_enabled: args.feeSavingEnabled === true,
        threshold,
      },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, error: "Could not save your choice." };
    revalidatePath("/pay/splits");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

