import { NextRequest } from "next/server";

import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { parseStartSplit } from "../../../../../../lib/mobile-splits";
import { loadMobileIntent } from "../../../../../../lib/pay/mobile-intent";
import { mobileSplitCtx, unwrapSplit } from "../../../../../../lib/pay/splits/mobile";
import { startSplit } from "../../../../../../lib/pay/splits/service";

// POST /api/mobile/pay/splits/start - create the plan and part 1. Part 1 is an
// ordinary draft payment intent the person hands off themselves; nothing is sent.
// The server recomputes the offer from the amount (the app never supplies parts),
// and the database refuses a plan whose total fits the network's capacity. The
// request id makes a double tap one plan. Same bearer guard (second factor
// complete) as the other pay routes.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "pay-split-start", async (body, { userId, token }) => {
    const parsed = parseStartSplit(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { ctx } = await mobileSplitCtx(userId, token);
    const { planId, intentId } = unwrapSplit(await startSplit(ctx, parsed.value));
    const intent = await loadMobileIntent(intentId);
    if (!intent) throw new Error("prepared intent not readable");
    return { planId, intent };
  });
}
