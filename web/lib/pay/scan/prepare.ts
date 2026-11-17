import "server-only";

import { createHash } from "node:crypto";
import { supabaseSession } from "../../supabase-session-server";
import { supabaseServer } from "../../supabase-server";
import {
  isSmsReconciliationEnabled,
  paymentIntentTtlHours,
  smsReconciliationMode,
} from "../gate";
import { maskMsisdn, normalizeRwandaMsisdn } from "../phone";
import { buildTelHref, fillUssdTemplate } from "../../ussd/capability";
import { parseOneLedgerPayload } from "./oneledger";
import { parseScan } from "./pipeline";
import { PROVIDER_LINK_ALLOWLIST } from "./provider-link";
import { matchUssdInDirectory, resolveMerchantPayCode } from "./resolve.server";
import { matchesTemplate, parseUssd } from "./ussd";
import {
  buildScanIntentPayload,
  oneledgerProviderToDirectory,
  scanTelHref,
  ussdPaymentType,
  ussdProvider,
} from "./handoff";
import { logScanError, trackScanEvent } from "../scan-analytics";
import { MAX_AMOUNT_MINOR, type ScanAmount } from "./types";

type Sb = Awaited<ReturnType<typeof supabaseSession>>;

// The shared "prepare / record a scanned payment" logic. The web server action
// (app/pay/scan/actions.ts) and the mobile routes (app/api/mobile/pay/scan/*)
// both call it, so a scan is prepared by one code path. Callers own the
// feature gate, the second-factor step-up, cache revalidation and how "session
// freshness" is read (cookie session on the web, the bearer token on mobile).

export const serverResolvers = {
  matchUssd: matchUssdInDirectory,
  providerAllowlist: PROVIDER_LINK_ALLOWLIST,
  now: () => Date.now(),
};

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
 * Re-parse `raw` authoritatively and prepare an external hand-off (see the web
 * action for the rules). Never trusts a client-supplied model: everything is
 * re-derived from `raw`. `userAmountMinor` is the only client input and is
 * re-validated.
 */
export async function prepareScanCore(args: {
  raw: string;
  userAmountMinor?: number;
  workspaceId: string;
  supabase: Sb;
  sessionFresh: boolean;
}): Promise<PrepareScanHandoffResult> {
  const { raw, userAmountMinor, workspaceId, supabase, sessionFresh } = args;
  try {
    const result = await parseScan(raw, serverResolvers);
    if (!result.ok) return { status: "unsupported" };
    const model = result.model;

    if (model.route.kind === "ussd" && model.route.literal != null) {
      return await prepareUssdHandoff(
        raw,
        model.route.literal,
        model.amount,
        workspaceId,
        supabase,
        sessionFresh,
      );
    }
    if (model.route.kind === "oneledger") {
      return await prepareOneLedgerHandoff(
        raw,
        model.route.currency,
        userAmountMinor,
        workspaceId,
        supabase,
        sessionFresh,
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
  sessionFresh: boolean,
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
    sessionFresh,
  });

  return createPreparedIntent(supabase, payload, telHref, "payment");
}

async function prepareOneLedgerHandoff(
  raw: string,
  currency: string,
  userAmountMinor: number | undefined,
  workspaceId: string,
  supabase: Sb,
  sessionFresh: boolean,
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
    sessionFresh,
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
  return {
    status: "prepared",
    intentId: row.id,
    telHref,
    existed: row.existed,
  };
}


export type RecordScanMethod = "dialer" | "copy";
export type RecordScanOutcome =
  | "dialer_opened"
  | "dialer_unsupported"
  | "copied"
  | "fallback_shown";

/**
 * Record the hand-off gesture on a prepared scan intent and move it to
 * awaiting_verification. A NAVIGATION event: it never claims the payment went
 * through. Throws on an unexpected failure; callers catch and revalidate.
 */
export async function recordScanHandoffCore(args: {
  supabase: Sb;
  workspaceId: string | null;
  intentId: string;
  method: RecordScanMethod;
  outcome: RecordScanOutcome;
}): Promise<void> {
  const { supabase, workspaceId, intentId, method, outcome } = args;
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
}
