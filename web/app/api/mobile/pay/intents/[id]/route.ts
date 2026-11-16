import { NextRequest } from "next/server";

import { isUuid } from "../../../../../../lib/mobile-pay";
import { mobileGet, mobileOptions } from "../../../../../../lib/mobile-request";
import { isPaymentIntentSurfaceEnabled } from "../../../../../../lib/pay/gate";
import { loadMobileIntent } from "../../../../../../lib/pay/mobile-intent";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";

// GET /api/mobile/pay/intents/:id - a payment intent and its prepared USSD
// instruction (the filled string and a `tel:` link), for the mobile review
// screen. Read under the caller's own RLS session, so another user's id is just
// "not found". Read-only.

export const OPTIONS = mobileOptions;

type Reason = "unavailable" | "not_found";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mobileGet(request, "pay-intent-read", async () => {
    const none = (reason: Reason) => ({ intent: null, reason });
    if (!isPaymentIntentSurfaceEnabled(await getActiveWorkspaceId())) {
      return none("unavailable");
    }
    if (!isUuid(id)) return none("not_found");
    const intent = await loadMobileIntent(id);
    return intent ? { intent } : none("not_found");
  });
}
