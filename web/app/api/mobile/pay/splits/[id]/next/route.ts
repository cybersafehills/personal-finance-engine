import { NextRequest } from "next/server";

import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../../lib/mobile-request";
import { parsePlanId } from "../../../../../../../lib/mobile-splits";
import { loadMobileIntent } from "../../../../../../../lib/pay/mobile-intent";
import { mobileSplitCtx, unwrapSplit } from "../../../../../../../lib/pay/splits/mobile";
import { startNextPart } from "../../../../../../../lib/pay/splits/service";

// POST /api/mobile/pay/splits/:id/next - prepare the next part as a draft intent,
// but only once the previous part is settled (successful, verified or manually
// confirmed): 409 `waiting` until then, `blocked` if the last part failed or
// expired, `stopped` / `complete` otherwise. Keeps SMS reconciliation
// unambiguous (it matches on exact amount, recipient and a 10-minute window).

export const OPTIONS = mobilePostOptions;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return mobilePost(request, "pay-split-next", async (_body, { userId, token }) => {
    const planId = parsePlanId(id);
    if (!planId) throw new MobileApiError(404, "not_found", "That split couldn't be found.");
    const { ctx } = await mobileSplitCtx(userId, token);
    const { intentId, index } = unwrapSplit(await startNextPart(ctx, planId));
    const intent = await loadMobileIntent(intentId);
    if (!intent) throw new Error("prepared intent not readable");
    return { planId, index, intent };
  });
}
