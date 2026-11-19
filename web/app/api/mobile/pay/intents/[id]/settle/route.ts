import { NextRequest } from "next/server";

import { isUuid, parseSettle } from "../../../../../../../lib/mobile-pay";
import {
  MobileApiError,
  mobilePost,
  mobilePostOptions,
} from "../../../../../../../lib/mobile-request";
import { isPaymentIntentSurfaceEnabled } from "../../../../../../../lib/pay/gate";
import { loadMobileIntent } from "../../../../../../../lib/pay/mobile-intent";
import { getActiveWorkspaceId } from "../../../../../../../lib/queries";
import { supabaseSession } from "../../../../../../../lib/supabase-session-server";

// POST /api/mobile/pay/intents/:id/settle - the person who dialled says whether
// the payment went through when no provider message has settled it: "sent" runs
// the same manually_confirm_payment RPC as the web's payment page, "failed" the
// same transition to failed. Never claims the provider verified it (the intent's
// `verified` stays false); a provider message arriving later still wins. Same
// bearer guard (second factor complete) as the other pay routes; the intent is
// read and changed under the caller's own RLS session.

export const OPTIONS = mobilePostOptions;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mobilePost(request, "pay-settle", async (body) => {
    const workspaceId = await getActiveWorkspaceId();
    if (!isPaymentIntentSurfaceEnabled(workspaceId)) {
      throw new MobileApiError(403, "feature_disabled", "Payments are turned off for your account.");
    }
    if (!isUuid(id)) throw new MobileApiError(404, "not_found", "That payment couldn't be found.");
    const parsed = parseSettle(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);

    const supabase = await supabaseSession();
    const { error } = parsed.value.outcome === "sent"
      ? await supabase.rpc("manually_confirm_payment", {
        p_intent_id: id,
        p_note: "Confirmed by me from the app",
      })
      : await supabase.rpc("transition_payment_intent", {
        p_id: id,
        p_to_state: "failed",
        p_reason: "Marked as not sent from the app",
        p_evidence: {},
      });
    if (error) {
      if (/not_found|not_authorized/i.test(error.message)) {
        throw new MobileApiError(404, "not_found", "That payment couldn't be found.");
      }
      if (/not_confirmable|invalid_transition/i.test(error.message)) {
        throw new MobileApiError(409, "not_allowed", "That isn't allowed from this payment's current state.");
      }
      throw new Error("settle failed");
    }

    const intent = await loadMobileIntent(id);
    if (!intent) throw new MobileApiError(404, "not_found", "That payment couldn't be found.");
    return { intent };
  });
}
