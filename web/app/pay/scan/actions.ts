"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { requireMfaForSensitiveAction } from "../../../lib/auth/assurance";
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
import { buildTelHref, fillUssdTemplate } from "../../../lib/ussd/capability";
import { parseOneLedgerPayload } from "../../../lib/pay/scan/oneledger";
import { parseScan } from "../../../lib/pay/scan/pipeline";
import { PROVIDER_LINK_ALLOWLIST } from "../../../lib/pay/scan/provider-link";
import {
  matchUssdInDirectory,
  resolveMerchantPayCode,
} from "../../../lib/pay/scan/resolve.server";
import { matchesTemplate, parseUssd } from "../../../lib/pay/scan/ussd";
import {
  buildScanIntentPayload,
  oneledgerProviderToDirectory,
  scanTelHref,
  ussdPaymentType,
  ussdProvider,
} from "../../../lib/pay/scan/handoff";
import { logScanError, trackScanEvent } from "../../../lib/pay/scan-analytics";
import {
  MAX_AMOUNT_MINOR,
  type ScanAmount,
  type ScanResult,
} from "../../../lib/pay/scan/types";

type Sb = Awaited<ReturnType<typeof supabaseSession>>;

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
  // A OneLedger code that carries no amount - the client must re-call
  // with a validated one.
  | { status: "amount_required" }
  // A OneLedger code in a currency no verified USSD code can pay.
  | { status: "currency_unsupported" }
  | { status: "error" };

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
 *
 * Never trusts a client-supplied model - everything is re-derived from
 * `raw`. `userAmountMinor` is the only client input, and it is
 * re-validated here.
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

  try {
    const result = await parseScan(raw, serverResolvers);
    if (!result.ok) return { status: "unsupported" };
    const model = result.model;
    const supabase = await supabaseSession();

    if (model.route.kind === "ussd" && model.route.literal != null) {
      return prepareUssdHandoff(
        raw,
        model.route.literal,
        model.amount,
        workspaceId,
        supabase,
      );
    }
    if (model.route.kind === "oneledger") {
      return prepareOneLedgerHandoff(
        raw,
        model.route.currency,
        userAmountMinor,
        workspaceId,
        supabase,
      );
    }
    return { status: "unsupported" };
  } catch (err) {
    logScanError("prepare_handoff", err);
    return { status: "error" };
  }
}

async function prepareUssdHandoff(
  raw: string,
  dial: string,
  amount: ScanAmount | null,
  workspaceId: string,
  supabase: Sb,
): Promise<PrepareScanHandoffResult> {
  const telHref = scanTelHref(dial);

  // No amount => a menu / inquiry code. Open it, record nothing.
  if (!amount) {
    trackScanEvent("scan_handoff_prepared", { kind: "info_only" });
    return { status: "info_only", telHref };
  }

  const parsed = parseUssd(raw);
  if (!parsed.ok) return { status: "unsupported" };
  const match = await matchUssdInDirectory(parsed.value.dial);
  if (!match) return { status: "unsupported" };
  const captured = matchesTemplate(parsed.value.dial, match.template)?.params ??
    {};

  const phoneRaw = captured.phone ?? captured.msisdn ?? captured.recipient ??
    null;
  const normalizedMsisdn = phoneRaw
    ? normalizeRwandaMsisdn(phoneRaw).normalized
    : null;

  const payload = buildScanIntentPayload({
    workspaceId,
    idempotencyKey: "qr:" +
      createHash("sha256").update(`${dial}|${amount.minor}`).digest("hex")
        .slice(0, 40),
    serviceCodeId: match.id,
    paymentType: ussdPaymentType(match.category, match.intent),
    provider: ussdProvider(match.networks, match.providerLabel),
    amountMinor: amount.minor,
    currency: amount.currency,
    ussdRedactedTemplate: match.template,
    category: match.category,
    note: null,
    recipientMsisdnNormalized: normalizedMsisdn,
    recipientMsisdnMasked: normalizedMsisdn
      ? maskMsisdn(normalizedMsisdn)
      : null,
    merchantCode: null,
    ttlHours: paymentIntentTtlHours(),
    sessionFresh: await isSessionFresh(),
  });

  return createPreparedIntent(supabase, payload, telHref, "payment");
}

async function prepareOneLedgerHandoff(
  raw: string,
  currency: string,
  userAmountMinor: number | undefined,
  workspaceId: string,
  supabase: Sb,
): Promise<PrepareScanHandoffResult> {
  // Verified USSD codes pay in RWF only.
  if (currency !== "RWF") return { status: "currency_unsupported" };

  const parsed = parseOneLedgerPayload(raw, { now: () => Date.now() });
  if (!parsed.ok) return { status: "unsupported" };
  const p = parsed.value;

  const amountMinor = p.amountMinor ??
    (typeof userAmountMinor === "number" ? Math.trunc(userAmountMinor) : null);
  if (amountMinor == null) return { status: "amount_required" };
  if (
    !Number.isInteger(amountMinor) || amountMinor <= 0 ||
    amountMinor >= MAX_AMOUNT_MINOR
  ) {
    return { status: "unsupported" };
  }

  const net = oneledgerProviderToDirectory(p.payload.provider);
  if (!net) return { status: "unsupported" };
  const code = await resolveMerchantPayCode(net);
  if (!code) return { status: "unsupported" };

  const fill = fillUssdTemplate(
    code.ussd_template,
    { merchant: p.payload.merchant_id, amount: String(amountMinor) },
    code.parameters.map((pp) => ({
      key: pp.key,
      kind: pp.kind,
      required: pp.required,
      formatRegex: pp.format_regex,
      minLength: pp.min_length,
      maxLength: pp.max_length,
    })),
  );
  if (!fill.ok) {
    logScanError("prepare_handoff", new Error(`oneledger fill: ${fill.error}`));
    return { status: "unsupported" };
  }
  const telHref = buildTelHref(fill.dial);

  const note = [
    p.reference ? `Ref ${p.reference}` : null,
    p.invoiceId ? `Invoice ${p.invoiceId}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || null;

  const payload = buildScanIntentPayload({
    workspaceId,
    idempotencyKey: "qr:" +
      createHash("sha256")
        .update(`ol|${net}|${p.payload.merchant_id}|${amountMinor}`)
        .digest("hex")
        .slice(0, 40),
    serviceCodeId: code.id,
    paymentType: "pay_merchant",
    provider: ussdProvider([net], code.provider?.display_name ?? null),
    amountMinor,
    currency: "RWF",
    ussdRedactedTemplate: code.ussd_template,
    category: code.category ?? null,
    note,
    recipientMsisdnNormalized: null,
    recipientMsisdnMasked: null,
    merchantCode: p.payload.merchant_id,
    ttlHours: paymentIntentTtlHours(),
    sessionFresh: await isSessionFresh(),
  });

  return createPreparedIntent(supabase, payload, telHref, "oneledger");
}

async function createPreparedIntent(
  supabase: Sb,
  payload: Record<string, unknown>,
  telHref: string,
  kind: "payment" | "oneledger",
): Promise<PrepareScanHandoffResult> {
  const { data, error } = await supabase.rpc("create_payment_intent", {
    payload,
  });
  if (error) {
    logScanError("prepare_handoff", error);
    return { status: "error" };
  }
  const row = data as { id: string; existed: boolean };
  trackScanEvent("scan_handoff_prepared", { kind });
  revalidatePath("/pay/activity");
  return {
    status: "prepared",
    intentId: row.id,
    telHref,
    existed: row.existed,
  };
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
    logScanError("record_handoff", err);
    return { ok: false };
  }
}
