import { NextRequest } from "next/server";

import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { parseSplitOffer } from "../../../../../../lib/mobile-splits";
import { mobileSplitCtx, unwrapSplit } from "../../../../../../lib/pay/splits/mobile";
import { offerForPayment } from "../../../../../../lib/pay/splits/service";

// POST /api/mobile/pay/splits/offer - "is there a split to suggest for this
// payment?". Read-only: nothing is created. Mirrors the web form's
// getSplitOfferAction through the same lib/pay/splits code. The body is POST (not
// a query string) so a phone number never lands in an access log. `offer` is null
// when the payment goes as one transfer, or splits are off for the account. An
// offer is a suggestion computed on the server from the amount; fees are
// estimates (a published ceiling for eKash), never guarantees.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "pay-split-offer", async (body, { userId, token }) => {
    const parsed = parseSplitOffer(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { ctx, splitsOn } = await mobileSplitCtx(userId, token, { offerOnly: true });
    if (!splitsOn) return { offer: null };
    return unwrapSplit(await offerForPayment(ctx, parsed.value));
  });
}
