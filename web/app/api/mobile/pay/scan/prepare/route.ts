import { NextRequest } from "next/server";

import { parsePrepareBody } from "../../../../../../lib/mobile-scan";
import {
  MobileApiError,
  mobilePost,
  mobilePostOptions,
  mobileSessionFresh,
} from "../../../../../../lib/mobile-request";
import { isScanToPayEnabled, paymentSessionFreshnessMinutes } from "../../../../../../lib/pay/gate";
import { prepareScanCore } from "../../../../../../lib/pay/scan/prepare";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";

// POST /api/mobile/pay/scan/prepare - turn a scanned code into a hand-off: for a
// payable code, a draft payment (source=qr_scan) and the `tel:` route to open;
// for a menu/balance code, just the route (nothing recorded). Never charges
// anything and never dials. Shares lib/pay/scan/prepare.ts with the web action,
// so the rules, the directory lookup and the idempotent create are one code path.
// The code is re-parsed from the raw text; the only client input besides it is
// the amount the user types when the code carries none, re-validated there.
// Recording that the user opened the dialer reuses
// POST /api/mobile/pay/intents/:id/handoff.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "pay-scan-prepare", async (body, { token }) => {
    const workspaceId = await getActiveWorkspaceId();
    if (!isScanToPayEnabled(workspaceId)) {
      throw new MobileApiError(403, "feature_disabled", "Scan to pay is turned off for your account.");
    }
    if (!workspaceId) throw new MobileApiError(422, "invalid_request", "No Space to prepare this payment in.");
    const parsed = parsePrepareBody(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);

    const outcome = await prepareScanCore({
      raw: parsed.raw,
      userAmountMinor: parsed.amountMinor,
      workspaceId,
      supabase: await supabaseSession(),
      sessionFresh: mobileSessionFresh(token, paymentSessionFreshnessMinutes()),
    });
    return { outcome };
  });
}
