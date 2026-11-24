import { NextRequest } from "next/server";

import { MobileApiError, mobileGet, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { parseSplitPrefs } from "../../../../../../lib/mobile-splits";
import { mobileSplitCtx, unwrapSplit } from "../../../../../../lib/pay/splits/mobile";
import { readSplitPrefs, saveSplitPrefs } from "../../../../../../lib/pay/splits/service";
import { THRESHOLD_MIN_SAVING_PER_EXTRA_PART } from "../../../../../../lib/pay/splits/split-math";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";

// GET / POST /api/mobile/pay/splits/preferences - the person's Save On choice for
// fee-saving suggestions (MTN to MTN). OFF until they turn it on; `threshold` is how
// much each extra transfer must save: any, balanced (50 RWF), bigger (250 RWF).
// Amounts over the eKash limit are always offered as parts and do not depend on it.

export const OPTIONS = mobilePostOptions;

const thresholds = () =>
  Object.entries(THRESHOLD_MIN_SAVING_PER_EXTRA_PART).map(([value, min]) => ({
    value,
    minSavingPerExtraPartMinor: min.toString(),
  }));

export function GET(request: NextRequest) {
  return mobileGet(request, "pay-split-prefs", async () => {
    // The handler runs under the caller's bearer token, so this is that user.
    const {
      data: { user },
    } = await (await supabaseSession()).auth.getUser();
    if (!user) throw new MobileApiError(403, "feature_disabled", "Sign in again.");
    const { ctx } = await mobileSplitCtx(user.id, "", { offerOnly: true });
    return { preferences: await readSplitPrefs(ctx), thresholds: thresholds() };
  });
}

export function POST(request: NextRequest) {
  return mobilePost(request, "pay-split-prefs-set", async (body, { userId, token }) => {
    const parsed = parseSplitPrefs(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { ctx } = await mobileSplitCtx(userId, token);
    const { prefs } = unwrapSplit(await saveSplitPrefs(ctx, parsed.value));
    return { preferences: prefs };
  });
}
