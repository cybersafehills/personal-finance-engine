"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { requireMfaForSensitiveAction } from "../../../lib/auth/assurance";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isScanToPayEnabled } from "../../../lib/pay/gate";
import { isSessionFresh } from "../../../lib/pay/intents";
import { parseScan } from "../../../lib/pay/scan/pipeline";
import {
  prepareScanCore,
  recordScanHandoffCore,
  serverResolvers,
  type PrepareScanHandoffResult,
} from "../../../lib/pay/scan/prepare";
import { logScanError, trackScanEvent } from "../../../lib/pay/scan-analytics";
import type { ScanResult } from "../../../lib/pay/scan/types";

export type { PrepareScanHandoffResult };

// Authoritative server-side handling for "Scan to pay". The browser
// decodes and can run the same pure pipeline for instant feedback, but
// everything that PERSISTS or acts goes through here: feature-gated,
// resolved against the RLS-scoped verified USSD directory + the central
// provider allowlist, re-parsed from the RAW string (never a
// client-supplied model). Logs only the coarse class / reason. The prepare and
// record logic lives in lib/pay/scan/prepare.ts, shared with the mobile routes.

// --- classify -------------------------------------------------------------

export type ClassifyScanResult =
  | { status: "ok"; result: ScanResult }
  | { status: "feature_disabled" }
  | { status: "error" };

export async function classifyScannedCode(
  raw: string,
): Promise<ClassifyScanResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isScanToPayEnabled(workspaceId)) return { status: "feature_disabled" };
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8192) {
    return { status: "error" };
  }

  try {
    const result = await parseScan(raw, serverResolvers);
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
    logScanError("classify", err);
    return { status: "error" };
  }
}

// --- prepare hand-off ---------------------------------------------------

/**
 * Re-parse `raw` authoritatively and prepare an external hand-off.
 *
 *  - **verified USSD + amount** -> create a payment_intents draft and
 *    return a `tel:` href.
 *  - **verified USSD, no amount** (menu / inquiry) -> `info_only`:
 *    openable, nothing persisted.
 *  - **OneLedger merchant payment (RWF)** -> map onto the network's
 *    pay-a-merchant USSD code, fill it with the merchant id + amount
 *    (from the payload, or `userAmountMinor` when the payload omits it),
 *    then behave exactly like the USSD path.
 */
export async function prepareScanHandoff(
  raw: string,
  userAmountMinor?: number,
): Promise<PrepareScanHandoffResult> {
  await requireMfaForSensitiveAction("/pay/scan");
  const workspaceId = await getActiveWorkspaceId();
  if (!isScanToPayEnabled(workspaceId)) return { status: "feature_disabled" };
  if (
    !workspaceId || typeof raw !== "string" || raw.length === 0 ||
    raw.length > 8192
  ) {
    return { status: "error" };
  }

  const result = await prepareScanCore({
    raw,
    userAmountMinor,
    workspaceId,
    supabase: await supabaseSession(),
    sessionFresh: await isSessionFresh(),
  });
  if (result.status === "prepared") revalidatePath("/pay/activity");
  return result;
}

// --- record hand-off gesture -----------------------------------------

export type RecordScanHandoffResult = { ok: true } | { ok: false };

/**
 * Record the hand-off gesture on a prepared scan intent and move it to
 * awaiting_verification. This is a NAVIGATION event - it never claims
 * the payment went through. Mirrors recordHandoff() in assisted-actions.
 */
export async function recordScanHandoff(
  intentId: string,
  method: "dialer" | "copy",
  outcome: "dialer_opened" | "dialer_unsupported" | "copied" | "fallback_shown",
): Promise<RecordScanHandoffResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isScanToPayEnabled(workspaceId)) return { ok: false };

  try {
    await recordScanHandoffCore({
      supabase: await supabaseSession(),
      workspaceId,
      intentId,
      method,
      outcome,
    });
    revalidatePath("/pay/activity");
    revalidatePath(`/pay/${intentId}`);
    return { ok: true };
  } catch (err) {
    logScanError("record_handoff", err);
    return { ok: false };
  }
}
