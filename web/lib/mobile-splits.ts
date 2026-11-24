// Payloads for the mobile app's split endpoints (POST /api/mobile/pay/splits/*).
// Pure: validates request bodies and maps a service error code to an HTTP
// status. Zero imports from server-only code so it is `deno test`-able. The
// authoritative offer is always recomputed server-side from the amount; nothing
// here (or in the app) can choose the parts.

import { isUuid, parseCreateIntent } from "./mobile-pay.ts";
import type { CreateIntentRequest } from "./mobile-pay.ts";
import { buildPanelData } from "./pay/splits/plan-state.ts";
import { isSplitThreshold, type SplitThreshold } from "./pay/splits/split-math.ts";

/** Only eKash has a capacity rule today; anything else is "no network chosen". */
export const SPLIT_NETWORK_SLUGS = ["ekash"] as const;

export type SplitOfferRequest = {
  paymentType: CreateIntentRequest["paymentType"];
  amountMinor: number;
  networkSlug?: string;
  sourceAccountId?: string;
  recipientMsisdn?: string;
};

export type SplitStartRequest = CreateIntentRequest & { networkSlug?: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function parseNetwork(v: unknown): Parsed<string | undefined> {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  if (typeof v === "string" && (SPLIT_NETWORK_SLUGS as readonly string[]).includes(v)) {
    return { ok: true, value: v };
  }
  return { ok: false, message: "That network isn't supported for splitting." };
}

/** Start body = the create-intent body (+ optional networkSlug). Same recipient rules. */
export function parseStartSplit(body: unknown): Parsed<SplitStartRequest> {
  const base = parseCreateIntent(body);
  if (!base.ok) return base;
  const net = parseNetwork((body as Record<string, unknown>).networkSlug);
  if (!net.ok) return net;
  return { ok: true, value: { ...base.value, networkSlug: net.value } };
}

/**
 * Offer body: what the app knows while the form is still being filled in, so the
 * recipient and request id are optional (the offer never creates anything).
 */
export function parseSplitOffer(body: unknown): Parsed<SplitOfferRequest> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Send the payment details as JSON." };
  }
  const b = body as Record<string, unknown>;
  if (b.paymentType !== "pay_person" && b.paymentType !== "pay_merchant") {
    return { ok: false, message: "That payment type isn't supported in the app." };
  }
  if (
    typeof b.amountMinor !== "number" || !Number.isInteger(b.amountMinor) ||
    b.amountMinor <= 0 || b.amountMinor > 999_999_999
  ) {
    return { ok: false, message: "Enter an amount greater than zero." };
  }
  if (b.sourceAccountId !== undefined && b.sourceAccountId !== null && !isUuid(b.sourceAccountId)) {
    return { ok: false, message: "That account isn't valid." };
  }
  if (
    b.recipientMsisdn !== undefined && b.recipientMsisdn !== null &&
    (typeof b.recipientMsisdn !== "string" || b.recipientMsisdn.length > 20)
  ) {
    return { ok: false, message: "That phone number isn't valid." };
  }
  const net = parseNetwork(b.networkSlug);
  if (!net.ok) return net;
  return {
    ok: true,
    value: {
      paymentType: b.paymentType,
      amountMinor: b.amountMinor,
      networkSlug: net.value,
      sourceAccountId: typeof b.sourceAccountId === "string" ? b.sourceAccountId : undefined,
      recipientMsisdn: typeof b.recipientMsisdn === "string" && b.recipientMsisdn.trim()
        ? b.recipientMsisdn.trim()
        : undefined,
    },
  };
}

/** The plan id in a path segment, or null. */
export const parsePlanId = (v: unknown): string | null => isUuid(v) ? v : null;

export type SplitErrorCode =
  | "not_found"
  | "invalid_account"
  | "no_split"
  | "waiting"
  | "blocked"
  | "stopped"
  | "complete"
  | "not_allowed"
  | "could_not_prepare"
  | "failed";

/**
 * HTTP status per service code. "failed" is unexpected (a 500 with no detail);
 * the conflicts (409) are states the app can show and retry later.
 */
export function splitErrorStatus(code: SplitErrorCode): 404 | 409 | 422 | null {
  switch (code) {
    case "not_found":
      return 404;
    case "waiting":
    case "blocked":
    case "stopped":
    case "complete":
    case "not_allowed":
      return 409;
    case "invalid_account":
    case "no_split":
    case "could_not_prepare":
      return 422;
    default:
      return null;
  }
}

export type SplitPrefsRequest = { feeSavingEnabled: boolean; threshold: SplitThreshold };

/** Fee-saving is opt-in: a missing flag is a refusal, never "on". */
export function parseSplitPrefs(body: unknown): Parsed<SplitPrefsRequest> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Send your choice as JSON." };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.feeSavingEnabled !== "boolean") {
    return { ok: false, message: "Choose whether to turn Save On suggestions on." };
  }
  if (!isSplitThreshold(b.threshold)) return { ok: false, message: "Pick one of the options." };
  return { ok: true, value: { feeSavingEnabled: b.feeSavingEnabled, threshold: b.threshold } };
}

type PlanIn = {
  id: string;
  kind: "capacity" | "fee_saving";
  network_slug: string | null;
  currency: string;
  total_amount_minor: number | string;
  planned_parts: readonly (string | number)[];
  single_fee_minor: number | string | null;
  planned_fee_minor: number | string | null;
  fee_basis: "none" | "published_maximum" | "verified_tariff";
  stopped_at: string | null;
};
type PartIn = { id: string; split_index: number; amount_minor: number | string; state: string };

export type MobilePlan = {
  id: string;
  kind: "capacity" | "fee_saving";
  networkSlug: string | null;
  currency: string;
  /** Money as digit strings (bigint-safe). */
  totalMinor: string;
  plannedPartsMinor: string[];
  singleFeeMinor: string | null;
  plannedFeeMinor: string | null;
  feeBasis: "none" | "published_maximum" | "verified_tariff";
  stopped: boolean;
  /** Parts already prepared, each a payment the person hands off; cancelled drafts are left out. */
  parts: { index: number; intentId: string; amountMinor: string; state: string }[];
  /** What the app may offer next. "ready" is the only state with a button. */
  next:
    | { status: "ready" | "waiting" | "blocked"; index: number; amountMinor: string }
    | { status: "complete" | "stopped" };
  remainingMinor: string;
  /** Fee-saving only: stop and send what is left as one transfer (web only for now). */
  canSendRemaining: boolean;
};

export function toMobilePlan(plan: PlanIn, parts: readonly PartIn[]): MobilePlan {
  const panel = buildPanelData(plan, parts);
  return {
    id: plan.id,
    kind: plan.kind,
    networkSlug: plan.network_slug,
    currency: plan.currency,
    totalMinor: String(plan.total_amount_minor),
    plannedPartsMinor: plan.planned_parts.map(String),
    singleFeeMinor: plan.single_fee_minor === null ? null : String(plan.single_fee_minor),
    plannedFeeMinor: plan.planned_fee_minor === null ? null : String(plan.planned_fee_minor),
    feeBasis: plan.fee_basis,
    stopped: plan.stopped_at !== null,
    parts: parts
      .filter((p) => p.state !== "cancelled")
      .map((p) => ({
        index: p.split_index,
        intentId: p.id,
        amountMinor: String(p.amount_minor),
        state: p.state,
      })),
    next: panel.next,
    remainingMinor: panel.remainingMinor,
    canSendRemaining: panel.canSendRemaining,
  };
}
