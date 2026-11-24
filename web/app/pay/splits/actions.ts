"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import {
  assertPaySplitsEnabled,
  FeatureDisabledError,
} from "../../../lib/pay/gate";
import { createPaymentIntent } from "../../../lib/pay/create-intent";
import { isSessionFresh } from "../../../lib/pay/intents";
import { requireMfaForSensitiveAction } from "../../../lib/auth/assurance";
import type { SplitOffer } from "../../../lib/pay/splits/offer";
import { getSplitPlan } from "../../../lib/pay/splits/plans";
import {
  draftFromPart,
  offerForPayment,
  rpcMessage,
  startNextPart,
  startSplit,
  stopSplit,
  type OfferQuery,
  type SplitCtx,
  type SplitResult,
  type StartSplitInput,
} from "../../../lib/pay/splits/service";
import {
  isSplitThreshold,
  type SplitThreshold,
} from "../../../lib/pay/splits/split-math";

// The web entry points. The logic lives in lib/pay/splits/service.ts, shared with
// the mobile API; this file adds what only the web has: the cookie session, the
// MFA step-up, the feature gate's exception mapping and cache revalidation.

export type { OfferQuery, SplitResult, StartSplitInput };

async function ctx(): Promise<{ sc: SplitCtx | null; workspaceId: string | null }> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getActiveWorkspaceId();
  if (!user) return { sc: null, workspaceId };
  return {
    sc: { supabase, userId: user.id, workspaceId, sessionFresh: await isSessionFresh() },
    workspaceId,
  };
}

function mapErr(err: unknown): { ok: false; error: string; code: "failed" } {
  if (err instanceof FeatureDisabledError) {
    return { ok: false, error: "Splits are not turned on for your account.", code: "failed" };
  }
  return { ok: false, error: "Something went wrong.", code: "failed" };
}

const SIGN_IN = { ok: false, error: "Sign in to prepare a payment.", code: "failed" } as const;

// ---------------------------------------------------------------------------
// Ask: is there a split to suggest for this amount? (read-only)
// ---------------------------------------------------------------------------

export async function getSplitOfferAction(
  q: OfferQuery,
): Promise<SplitResult<{ offer: SplitOffer | null }>> {
  try {
    const { sc } = await ctx();
    if (!sc) return SIGN_IN;
    return await offerForPayment(sc, q);
  } catch {
    // A suggestion is never worth failing the form for.
    return { ok: true, offer: null };
  }
}

// ---------------------------------------------------------------------------
// Start: create the plan and part 1 (a normal draft intent)
// ---------------------------------------------------------------------------

export async function startSplitAction(
  input: StartSplitInput,
): Promise<SplitResult<{ planId: string; intentId: string }>> {
  await requireMfaForSensitiveAction("/pay");
  try {
    const { sc, workspaceId } = await ctx();
    if (!sc) return SIGN_IN;
    assertPaySplitsEnabled(workspaceId);
    const res = await startSplit(sc, input);
    if (res.ok) revalidatePath("/pay/activity");
    return res;
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// Next part / stop / send the rest as one
// ---------------------------------------------------------------------------

/** Prepare the next part, but only once the previous one is settled. */
export async function startNextSplitPartAction(
  planId: string,
): Promise<SplitResult<{ intentId: string; index: number }>> {
  await requireMfaForSensitiveAction("/pay");
  try {
    const { sc, workspaceId } = await ctx();
    if (!sc) return SIGN_IN;
    assertPaySplitsEnabled(workspaceId);
    const res = await startNextPart(sc, planId);
    if (res.ok) {
      revalidatePath(`/pay/${res.intentId}`);
      revalidatePath("/pay/activity");
    }
    return res;
  } catch (err) {
    return mapErr(err);
  }
}

/** Stop the split: no more parts, and any unsent draft part is cancelled. */
export async function stopSplitPlanAction(planId: string): Promise<SplitResult> {
  try {
    const { sc, workspaceId } = await ctx();
    if (!sc) return SIGN_IN;
    assertPaySplitsEnabled(workspaceId);
    const res = await stopSplit(sc, planId);
    if (res.ok) revalidatePath("/pay/activity");
    return res;
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
  const bad = (error: string) => ({ ok: false, error, code: "failed" }) as const;
  try {
    const { sc, workspaceId } = await ctx();
    if (!sc) return SIGN_IN;
    assertPaySplitsEnabled(workspaceId);
    const { supabase } = sc;

    const loaded = await getSplitPlan(planId);
    if (!loaded) return bad("That split was not found.");
    const { plan, parts } = loaded;
    if (plan.kind !== "fee_saving") return bad("This amount can't be sent as one transfer.");
    if (plan.stopped_at) return bad("This split was stopped.");
    const live = parts.filter((p) => p.state !== "cancelled");
    const first = live.find((p) => p.split_index === 1);
    if (!first) return bad("That split has no first part.");
    if (live.some((p) => p.state !== "successful")) {
      return bad("Finish the part in progress first: confirm that it went through.");
    }
    const sent = live.reduce((sum, p) => sum + BigInt(p.amount_minor), 0n);
    const remaining = BigInt(plan.total_amount_minor) - sent;
    if (remaining <= 0n) return bad("Nothing is left to send.");

    const stopped = await supabase.rpc("stop_payment_split_plan", { p_plan: planId });
    if (stopped.error) return bad(rpcMessage(stopped.error.message));

    const created = await createPaymentIntent({
      supabase,
      workspaceId: plan.workspace_id,
      input: draftFromPart(first, Number(remaining), `plan:${planId}:remainder`),
      sessionFresh: sc.sessionFresh,
      accountProvider: first.provider,
    });
    if (!created.ok) return bad(created.error);
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
    const { sc, workspaceId } = await ctx();
    if (!sc) return { ok: false, error: "Sign in first.", code: "failed" };
    assertPaySplitsEnabled(workspaceId);
    if (!isSplitThreshold(args.threshold)) {
      return { ok: false, error: "Pick one of the options.", code: "failed" };
    }
    const threshold: SplitThreshold = args.threshold;
    const { error } = await sc.supabase.from("pay_split_preferences").upsert(
      {
        user_id: sc.userId,
        fee_saving_enabled: args.feeSavingEnabled === true,
        threshold,
      },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, error: "Could not save your choice.", code: "failed" };
    revalidatePath("/pay/splits");
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}
