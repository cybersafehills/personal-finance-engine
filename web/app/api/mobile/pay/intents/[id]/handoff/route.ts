import { NextRequest } from "next/server";

import { isUuid, parseHandoff } from "../../../../../../../lib/mobile-pay";
import {
  MobileApiError,
  mobilePost,
  mobilePostOptions,
} from "../../../../../../../lib/mobile-request";
import { isPaymentIntentSurfaceEnabled } from "../../../../../../../lib/pay/gate";
import { recordPaymentHandoff } from "../../../../../../../lib/pay/handoff";
import { loadMobileIntent } from "../../../../../../../lib/pay/mobile-intent";
import { getActiveWorkspaceId } from "../../../../../../../lib/queries";
import { supabaseSession } from "../../../../../../../lib/supabase-session-server";

// POST /api/mobile/pay/intents/:id/handoff - record that the user opened the
// dialer or copied the code, moving the intent draft -> awaiting_verification so
// the payment SMS can later be matched to it. A navigation event, never a claim
// that the payment succeeded. Shares lib/pay/handoff.ts with the web action.
// Same bearer guard (second factor complete) as the create route; the intent is
// read and changed under the caller's own RLS session, so another user's id is
// simply "not found".

export const OPTIONS = mobilePostOptions;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mobilePost(request, "pay-handoff", async (body) => {
    const workspaceId = await getActiveWorkspaceId();
    if (!isPaymentIntentSurfaceEnabled(workspaceId)) {
      throw new MobileApiError(403, "feature_disabled", "Payments are turned off for your account.");
    }
    if (!isUuid(id)) throw new MobileApiError(404, "not_found", "That payment couldn't be found.");
    const parsed = parseHandoff(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);

    const result = await recordPaymentHandoff({
      supabase: await supabaseSession(),
      workspaceId,
      id,
      method: parsed.value.method,
      outcome: parsed.value.outcome,
    });
    // `not_found` covers an unknown id and one in a workspace the user is not in.
    if (!result.ok) {
      throw result.reason === "not_found"
        ? new MobileApiError(404, "not_found", "That payment couldn't be found.")
        : new Error("handoff failed");
    }

    const intent = await loadMobileIntent(id);
    if (!intent) throw new MobileApiError(404, "not_found", "That payment couldn't be found.");
    return { intent };
  });
}
