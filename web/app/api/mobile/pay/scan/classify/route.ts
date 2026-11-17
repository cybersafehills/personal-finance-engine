import { NextRequest } from "next/server";

import { parseClassifyBody } from "../../../../../../lib/mobile-scan";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { isScanToPayEnabled } from "../../../../../../lib/pay/gate";
import { parseScan } from "../../../../../../lib/pay/scan/pipeline";
import { serverResolvers } from "../../../../../../lib/pay/scan/prepare";
import { logScanError, trackScanEvent } from "../../../../../../lib/pay/scan-analytics";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";

// POST /api/mobile/pay/scan/classify - read a scanned QR string and say what it
// is (a verified USSD code, an approved payment link, a OneLedger merchant
// code), already redacted for display. Read-only: nothing is stored and nothing
// is dialed. The same pipeline as the web's classifyScannedCode: the scan is
// data, never authorization, and anything unknown or suspicious is rejected
// with a coarse reason. Logs only the class / reason, never the payload.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "pay-scan-classify", async (body) => {
    const workspaceId = await getActiveWorkspaceId();
    if (!isScanToPayEnabled(workspaceId)) {
      throw new MobileApiError(403, "feature_disabled", "Scan to pay is turned off for your account.");
    }
    const parsed = parseClassifyBody(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);

    try {
      const result = await parseScan(parsed.raw, serverResolvers);
      if (result.ok) trackScanEvent("scan_payload_classified", { kind: result.model.class });
      else trackScanEvent("scan_payload_rejected", { kind: result.class, reason: result.reason });
      return { result };
    } catch (err) {
      logScanError("classify", err);
      throw new MobileApiError(422, "scan_failed", "Couldn't read that code. Try again.");
    }
  });
}
