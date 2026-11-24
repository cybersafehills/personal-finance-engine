import { NextRequest } from "next/server";

import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../../lib/mobile-request";
import { parsePlanId } from "../../../../../../../lib/mobile-splits";
import { mobileSplitCtx, unwrapSplit } from "../../../../../../../lib/pay/splits/mobile";
import { stopSplit } from "../../../../../../../lib/pay/splits/service";

// POST /api/mobile/pay/splits/:id/stop - no more parts; any draft part that was
// never handed off is cancelled, and parts already settled are left alone.
// Stopping is idempotent from the app's point of view.

export const OPTIONS = mobilePostOptions;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return mobilePost(request, "pay-split-stop", async (_body, { userId, token }) => {
    const planId = parsePlanId(id);
    if (!planId) throw new MobileApiError(404, "not_found", "That split couldn't be found.");
    const { ctx } = await mobileSplitCtx(userId, token);
    unwrapSplit(await stopSplit(ctx, planId));
    return { planId, stopped: true };
  });
}
