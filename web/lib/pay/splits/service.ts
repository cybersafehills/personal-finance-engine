import "server-only";

import type { supabaseSession } from "../../supabase-session-server";
import type { SplitErrorCode } from "../../mobile-splits";
import { createPaymentIntent, type DraftInput } from "../create-intent";
import { isPaymentNetworksEnabled, isPaySplitsEnabled } from "../gate";
import { getSplitOffer, loadSplitPrefs, type SplitOffer, type SplitOfferInput, type SplitPrefs } from "./offer";
import { isSplitThreshold, type SplitThreshold } from "./split-math";
import { getSplitPlan, nextPartStatus, type SplitPartRow } from "./plans";

// The split flow's business logic, shared by the web server actions
// (app/pay/splits/actions.ts: cookie session, MFA step-up, revalidation) and the
// mobile API (app/api/mobile/pay/splits/*: bearer guard). Both callers MUST have
// authenticated the user and checked the feature gate before calling in; this
// module trusts `ctx`, but never trusts the parts: every offer is recomputed here
// from the amount, and the database re-checks capacity and ordering.
//
// OneLedger never moves money (ADR 0001): a part is an ordinary draft payment
// intent that the user hands off themselves, one at a time.

type Session = Awaited<ReturnType<typeof supabaseSession>>;

export type SplitCtx = {
  supabase: Session;
  userId: string;
  workspaceId: string | null;
  /** Whether the caller's sign-in is recent enough for a payment draft. */
  sessionFresh: boolean;
  /**
   * When set, a source account must belong to exactly this Space (the mobile API
   * has no session cookie to scope it, and the RPC only checks membership).
   */
  requireAccountInWorkspace?: string | null;
};

export type { SplitErrorCode };

export type SplitResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code: SplitErrorCode };

const fail = (code: SplitErrorCode, error: string): { ok: false; error: string; code: SplitErrorCode } => ({
  ok: false,
  error,
  code,
});

export function rpcMessage(message: string): string {
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

function rpcCode(message: string): SplitErrorCode {
  if (/previous_part_not_settled/i.test(message)) return "waiting";
  if (/plan_stopped/i.test(message)) return "stopped";
  if (/not_authorized|not_found/i.test(message)) return "not_found";
  if (/not_over_capacity|part_over_capacity|amount_mismatch/i.test(message)) return "not_allowed";
  return "failed";
}

type AccountFacts = {
  workspaceId: string | null;
  provider: string | null;
  currency: string;
  found: boolean;
};

/** The Space that owns `accountId`, plus its provider and currency. Under the caller's RLS. */
async function accountFacts(ctx: SplitCtx, accountId: string | undefined): Promise<AccountFacts> {
  if (!accountId) return { workspaceId: null, provider: null, currency: "RWF", found: true };
  let q = ctx.supabase
    .from("accounts")
    .select("workspace_id, provider, currency")
    .eq("id", accountId);
  if (ctx.requireAccountInWorkspace) {
    q = q.eq("workspace_id", ctx.requireAccountInWorkspace).eq("is_active", true);
  }
  const { data } = await q.maybeSingle();
  if (!data) return { workspaceId: null, provider: null, currency: "RWF", found: false };
  return {
    workspaceId: (data.workspace_id as string | undefined) ?? null,
    provider: (data.provider as string | undefined) ?? null,
    currency: (data.currency as string | undefined) ?? "RWF",
    found: true,
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

export async function offerForPayment(
  ctx: SplitCtx,
  q: OfferQuery,
): Promise<SplitResult<{ offer: SplitOffer | null }>> {
  if (!isPaySplitsEnabled(ctx.workspaceId)) return { ok: true, offer: null };
  const acct = await accountFacts(ctx, q.sourceAccountId);
  if (!acct.found) return fail("invalid_account", "That account isn't available.");
  const input: SplitOfferInput = {
    paymentType: q.paymentType,
    networkSlug: q.networkSlug ?? null,
    accountProvider: acct.provider,
    recipientMsisdn: q.recipientMsisdn ?? null,
    amountMinor: q.amountMinor,
    currency: acct.currency,
  };
  const offer = await getSplitOffer({
    supabase: ctx.supabase,
    userId: ctx.userId,
    paymentNetworksEnabled: isPaymentNetworksEnabled(ctx.workspaceId),
    input,
  });
  return { ok: true, offer };
}

// ---------------------------------------------------------------------------
// Start: create the plan and part 1 (a normal draft intent)
// ---------------------------------------------------------------------------

export type StartSplitInput = DraftInput & {
  networkSlug?: string | null;
  /** Client key for this request, so a double-submit is one plan. */
  idempotencyKey: string;
};

export async function startSplit(
  ctx: SplitCtx,
  input: StartSplitInput,
): Promise<SplitResult<{ planId: string; intentId: string }>> {
  if (!input.idempotencyKey) return fail("failed", "Missing request key.");
  const acct = await accountFacts(ctx, input.sourceAccountId);
  if (!acct.found) return fail("invalid_account", "That account isn't available.");

  // Never trust the parts from the caller: recompute the offer here.
  const offer = await getSplitOffer({
    supabase: ctx.supabase,
    userId: ctx.userId,
    paymentNetworksEnabled: isPaymentNetworksEnabled(ctx.workspaceId),
    input: {
      paymentType: input.paymentType,
      networkSlug: input.networkSlug ?? null,
      accountProvider: acct.provider,
      recipientMsisdn: input.recipientMsisdn ?? null,
      amountMinor: input.amountMinor,
      currency: acct.currency,
    },
  });
  if (!offer) return fail("no_split", "No split is available for this payment.");

  const intentWorkspaceId = acct.workspaceId ?? ctx.workspaceId;
  const { data: plan, error: planErr } = await ctx.supabase.rpc("create_payment_split_plan", {
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
  if (planErr) return fail(rpcCode(planErr.message), rpcMessage(planErr.message));
  const planId = (plan as { id: string }).id;

  const first = await createPaymentIntent({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    input: {
      ...input,
      amountMinor: Number(offer.parts[0].amountMinor),
      idempotencyKey: `plan:${input.idempotencyKey}:1`,
    },
    sessionFresh: ctx.sessionFresh,
    accountProvider: acct.provider,
  });
  if (!first.ok) return fail("could_not_prepare", first.error);

  const { error: attachErr } = await ctx.supabase.rpc("attach_intent_to_split_plan", {
    p_plan: planId,
    p_intent: first.id,
    p_index: 1,
  });
  // A retry returns the same intent, already attached: that is fine.
  if (attachErr && !/intent_not_attachable/i.test(attachErr.message)) {
    return fail(rpcCode(attachErr.message), rpcMessage(attachErr.message));
  }
  return { ok: true, planId, intentId: first.id };
}

// ---------------------------------------------------------------------------
// Next part / stop
// ---------------------------------------------------------------------------

export function draftFromPart(first: SplitPartRow, amountMinor: number, key: string): DraftInput {
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
export async function startNextPart(
  ctx: SplitCtx,
  planId: string,
): Promise<SplitResult<{ intentId: string; index: number }>> {
  const loaded = await getSplitPlan(planId);
  if (!loaded) return fail("not_found", "That split was not found.");
  const { plan, parts } = loaded;
  const first = parts.find((p) => p.split_index === 1);
  if (!first) return fail("not_found", "That split has no first part.");

  const next = nextPartStatus(plan, parts);
  if (next.status === "stopped") return fail("stopped", "This split was stopped.");
  if (next.status === "complete") return fail("complete", "Every part is already prepared.");
  if (next.status === "blocked") {
    return fail("blocked", "The last part didn't go through. Stop this split or contact your provider.");
  }
  if (next.status === "waiting") {
    return fail("waiting", "Finish the previous part first: confirm that it went through.");
  }

  const created = await createPaymentIntent({
    supabase: ctx.supabase,
    workspaceId: plan.workspace_id,
    input: draftFromPart(first, Number(next.amountMinor), `plan:${planId}:${next.index}`),
    sessionFresh: ctx.sessionFresh,
    accountProvider: first.provider,
  });
  if (!created.ok) return fail("could_not_prepare", created.error);

  const { error } = await ctx.supabase.rpc("attach_intent_to_split_plan", {
    p_plan: planId,
    p_intent: created.id,
    p_index: next.index,
  });
  if (error && !/intent_not_attachable/i.test(error.message)) {
    return fail(rpcCode(error.message), rpcMessage(error.message));
  }
  return { ok: true, intentId: created.id, index: next.index };
}

/** Stop the split: no more parts, and any unsent draft part is cancelled. */
export async function stopSplit(ctx: SplitCtx, planId: string): Promise<SplitResult> {
  const { error } = await ctx.supabase.rpc("stop_payment_split_plan", { p_plan: planId });
  if (error) return fail(rpcCode(error.message), rpcMessage(error.message));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Preferences (fee-saving suggestions: off until the user turns them on)
// ---------------------------------------------------------------------------

export function readSplitPrefs(ctx: SplitCtx): Promise<SplitPrefs> {
  return loadSplitPrefs(ctx.supabase, ctx.userId);
}

export async function saveSplitPrefs(
  ctx: SplitCtx,
  args: { feeSavingEnabled: boolean; threshold: string },
): Promise<SplitResult<{ prefs: SplitPrefs }>> {
  if (!isSplitThreshold(args.threshold)) return fail("failed", "Pick one of the options.");
  const threshold: SplitThreshold = args.threshold;
  const feeSavingEnabled = args.feeSavingEnabled === true;
  const { error } = await ctx.supabase.from("pay_split_preferences").upsert(
    { user_id: ctx.userId, fee_saving_enabled: feeSavingEnabled, threshold },
    { onConflict: "user_id" },
  );
  if (error) return fail("failed", "Could not save your choice.");
  return { ok: true, prefs: { feeSavingEnabled, threshold } };
}
