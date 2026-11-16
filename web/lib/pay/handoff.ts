import "server-only";

import { supabaseServer } from "../supabase-server";
import { supabaseSession } from "../supabase-session-server";
import { isSmsReconciliationEnabled, smsReconciliationMode } from "./gate";

// Recording a handoff gesture (the user opened the dialer / copied the code):
// the intent moves draft -> initiated -> awaiting_verification. This is a
// *navigation* event, not a payment - it never claims the payment succeeded.
// Shared by the web server action (app/pay/assisted-actions.ts, which keeps its
// gate, revalidation and error-swallowing) and the mobile API
// (app/api/mobile/pay/intents/[id]/handoff). Callers MUST have already checked
// the payment-intent surface gate.

export type HandoffMethod = "dialer" | "copy" | "qr";
export type HandoffOutcome =
  | "dialer_opened"
  | "dialer_unsupported"
  | "copied"
  | "qr_shown"
  | "fallback_shown";

export type HandoffResult =
  | { ok: true }
  /** `record_payment_attempt` refused: no such intent for this user, or not a member. */
  | { ok: false; reason: "not_found" | "failed" };

export async function recordPaymentHandoff(args: {
  supabase: Awaited<ReturnType<typeof supabaseSession>>;
  workspaceId: string | null;
  id: string;
  method: HandoffMethod;
  outcome: HandoffOutcome;
}): Promise<HandoffResult> {
  const { supabase, workspaceId, id, method, outcome } = args;

  const { error: attemptError } = await supabase.rpc("record_payment_attempt", {
    p_intent_id: id,
    p_method: method,
    p_outcome: outcome,
  });
  // Reported to the caller (the web ignores it, as it always has); the
  // transitions below are still attempted so the web's behaviour is unchanged.
  const attemptFailure: HandoffResult | null = attemptError
    ? {
      ok: false,
      reason: /not_found|not_authorized/i.test(attemptError.message)
        ? "not_found"
        : "failed",
    }
    : null;

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

  // Phase 2b: the payment SMS may already have been ingested (the user dialed,
  // paid, and came back before we got here). Best-effort, opt-in, non-fatal.
  // Uses the service-role client because the matcher RPC is service_role-only
  // (system actor) - the single, isolated place an assisted-pay action reaches
  // for it.
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

  return attemptFailure ?? { ok: true };
}
