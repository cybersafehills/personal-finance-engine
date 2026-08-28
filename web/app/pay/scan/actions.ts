"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import {
  isScanToPayEnabled,
  isSmsReconciliationEnabled,
  paymentIntentTtlHours,
  smsReconciliationMode,
} from "../../../lib/pay/gate";
import { isSessionFresh } from "../../../lib/pay/intents";
import { maskMsisdn, normalizeRwandaMsisdn } from "../../../lib/pay/phone";
import { parseScan } from "../../../lib/pay/scan/pipeline";
import { PROVIDER_LINK_ALLOWLIST } from "../../../lib/pay/scan/provider-link";
import { matchUssdInDirectory } from "../../../lib/pay/scan/resolve.server";
import { matchesTemplate, parseUssd } from "../../../lib/pay/scan/ussd";
import {
  buildScanIntentPayload,
  scanTelHref,
  ussdPaymentType,
  ussdProvider,
} from "../../../lib/pay/scan/handoff";
import { trackScanEvent } from "../../../lib/pay/scan-analytics";
import type { ScanResult } from "../../../lib/pay/scan/types";

// Authoritative server-side handling for "Scan to pay". The browser
// decodes and can run the same pure pipeline for instant feedback, but
// everything that PERSISTS or acts goes through here: feature-gated,
// resolved against the RLS-scoped verified USSD directory + the central
// provider allowlist, re-parsed from the RAW string (never a
// client-supplied model). Logs only the coarse class / reason.

const serverResolvers = {
  matchUssd: matchUssdInDirectory,
  providerAllowlist: PROVIDER_LINK_ALLOWLIST,
  now: () => Date.now(),
};

// --- classify -------------------------------------------------------------

export type ClassifyScanResult =
  | { status: "ok"; result: ScanResult }
  | { status: "feature_disabled" }
  | { status: "error" };

export async function classifyScannedCode(raw: string): Promise<ClassifyScanResult> {
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
      trackScanEvent("scan_payload_rejected", { kind: result.class, reason: result.reason });
    }
    return { status: "ok", result };
  } catch (err) {
    console.error("classifyScannedCode failed:", (err as Error).message);
    return { status: "error" };
  }
}

// --- prepare hand-off ---------------------------------------------------

export type PrepareScanHandoffResult =
  | {
      // A payable scan: a payment_intents draft (source=qr_scan) exists.
      status: "prepared";
      intentId: string;
      telHref: string;
      existed: boolean;
    }
  // A menu / balance code - openable, but not a payment: nothing recorded.
  | { status: "info_only"; telHref: string }
  | { status: "feature_disabled" }
  | { status: "unsupported" }
  | { status: "error" };

/**
 * Re-parse `raw` authoritatively. If it resolves to a verified USSD
 * instruction carrying an amount, create the payment_intents draft and
 * return a `tel:` href for the client to open on the user's gesture. A
 * menu code (no amount) is returned `info_only` - openable, nothing
 * persisted, because it is navigation, not a payment.
 */
export async function prepareScanHandoff(raw: string): Promise<PrepareScanHandoffResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isScanToPayEnabled(workspaceId)) return { status: "feature_disabled" };
  if (!workspaceId || typeof raw !== "string" || raw.length === 0 || raw.length > 8192) {
    return { status: "error" };
  }

  try {
    const result = await parseScan(raw, serverResolvers);
    if (!result.ok) return { status: "unsupported" };
    const model = result.model;
    if (model.route.kind !== "ussd" || model.route.literal == null) {
      return { status: "unsupported" };
    }
    const dial = model.route.literal;
    const telHref = scanTelHref(dial);

    // No amount => a menu / inquiry code. Open it, record nothing.
    if (!model.amount) {
      trackScanEvent("scan_handoff_prepared", { kind: "info_only" });
      return { status: "info_only", telHref };
    }

    // Re-derive the directory row + captured params from the raw string.
    const parsed = parseUssd(raw);
    if (!parsed.ok) return { status: "unsupported" };
    const match = await matchUssdInDirectory(parsed.value.dial);
    if (!match) return { status: "unsupported" };
    const captured = matchesTemplate(parsed.value.dial, match.template)?.params ?? {};

    const phoneRaw = captured.phone ?? captured.msisdn ?? captured.recipient ?? null;
    const normalizedMsisdn = phoneRaw ? normalizeRwandaMsisdn(phoneRaw).normalized : null;

    const supabase = await supabaseSession();
    const payload = buildScanIntentPayload({
      workspaceId,
      // Deterministic: the same code + amount within the TTL is the same
      // intent, not a duplicate (create_payment_intent dedupes on this).
      idempotencyKey:
        "qr:" + createHash("sha256").update(`${dial}|${model.amount.minor}`).digest("hex").slice(0, 40),
      serviceCodeId: match.id,
      paymentType: ussdPaymentType(match.category, match.intent),
      provider: ussdProvider(match.networks, match.providerLabel),
      amountMinor: model.amount.minor,
      currency: model.amount.currency,
      ussdRedactedTemplate: match.template,
      category: match.category,
      note: null,
      recipientMsisdnNormalized: normalizedMsisdn,
      recipientMsisdnMasked: normalizedMsisdn ? maskMsisdn(normalizedMsisdn) : null,
      ttlHours: paymentIntentTtlHours(),
      sessionFresh: await isSessionFresh(),
    });

    const { data, error } = await supabase.rpc("create_payment_intent", { payload });
    if (error) {
      console.error("prepareScanHandoff create failed:", error.message);
      return { status: "error" };
    }
    const row = data as { id: string; existed: boolean };
    trackScanEvent("scan_handoff_prepared", { kind: "payment" });
    revalidatePath("/pay/activity");
    return { status: "prepared", intentId: row.id, telHref, existed: row.existed };
  } catch (err) {
    console.error("prepareScanHandoff failed:", (err as Error).message);
    return { status: "error" };
  }
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
    const supabase = await supabaseSession();
    await supabase.rpc("record_payment_attempt", {
      p_intent_id: intentId,
      p_method: method,
      p_outcome: outcome,
    });
    // draft -> initiated -> awaiting_verification. A repeat gesture on an
    // already-advanced intent just no-ops on "invalid_transition".
    await supabase.rpc("transition_payment_intent", {
      p_id: intentId,
      p_to_state: "initiated",
      p_reason: null,
      p_evidence: { method, source: "qr_scan" },
    });
    await supabase.rpc("transition_payment_intent", {
      p_id: intentId,
      p_to_state: "awaiting_verification",
      p_reason: null,
      p_evidence: {},
    });

    if (isSmsReconciliationEnabled(workspaceId)) {
      try {
        await supabaseServer().rpc("reconcile_payment_intent", {
          p_intent_id: intentId,
          p_mode: smsReconciliationMode(),
        });
      } catch {
        /* non-fatal */
      }
    }

    trackScanEvent("scan_attempt_awaiting", { method });
    revalidatePath("/pay/activity");
    revalidatePath(`/pay/${intentId}`);
    return { ok: true };
  } catch (err) {
    console.error("recordScanHandoff failed:", (err as Error).message);
    return { ok: false };
  }
}
