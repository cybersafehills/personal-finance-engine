// Payloads for the mobile app's split endpoints (POST /api/mobile/pay/splits/*).
// Pure: validates request bodies and maps a service error code to an HTTP
// status. Zero imports from server-only code so it is `deno test`-able. The
// authoritative offer is always recomputed server-side from the amount; nothing
// here (or in the app) can choose the parts.

import { isUuid, parseCreateIntent } from "./mobile-pay.ts";
import type { CreateIntentRequest } from "./mobile-pay.ts";

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
