"use server";

import { getActiveWorkspaceId } from "../../../lib/queries";
import { isScanToPayEnabled } from "../../../lib/pay/gate";
import { parseScan } from "../../../lib/pay/scan/pipeline";
import { PROVIDER_LINK_ALLOWLIST } from "../../../lib/pay/scan/provider-link";
import { matchUssdInDirectory } from "../../../lib/pay/scan/resolve.server";
import { trackScanEvent } from "../../../lib/pay/scan-analytics";
import type { ScanResult } from "../../../lib/pay/scan/types";

// Authoritative classification of a decoded QR string. The browser
// decodes and can run the same pure pipeline for instant feedback, but
// THIS is the trusted pass: it is feature-gated server-side, resolves
// against the RLS-scoped verified USSD directory and the central
// provider allowlist, and is the only classification R3 will be allowed
// to act on. It persists nothing (that is R3/R4) and logs only the
// coarse class / reason - never the payload.

export type ClassifyScanResult =
  | { status: "ok"; result: ScanResult }
  | { status: "feature_disabled" }
  | { status: "error" };

export async function classifyScannedCode(raw: string): Promise<ClassifyScanResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isScanToPayEnabled(workspaceId)) {
    return { status: "feature_disabled" };
  }

  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8192) {
    return { status: "error" };
  }

  try {
    const result = await parseScan(raw, {
      matchUssd: matchUssdInDirectory,
      providerAllowlist: PROVIDER_LINK_ALLOWLIST,
      now: () => Date.now(),
    });

    if (result.ok) {
      trackScanEvent("scan_payload_classified", { kind: result.model.class });
    } else {
      trackScanEvent("scan_payload_rejected", {
        kind: result.class,
        reason: result.reason,
      });
    }
    return { status: "ok", result };
  } catch (err) {
    console.error("classifyScannedCode failed:", (err as Error).message);
    return { status: "error" };
  }
}
