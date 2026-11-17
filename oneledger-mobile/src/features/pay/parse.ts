import { failureForStatus, type BearerFailure } from "@/api/bearer";

import type { PayConfig, PayInstruction, PayIntent } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const strOrNull = (v: unknown): string | null => (str(v) ? v : null);

function parseInstruction(raw: unknown): PayInstruction | null {
  if (!isRecord(raw)) return null;
  if (raw.ok === true && str(raw.display) && str(raw.telHref)) {
    // Only ever a plain tel: link; anything else is dropped, never opened.
    if (!raw.telHref.startsWith("tel:")) return null;
    return { ok: true, display: raw.display, telHref: raw.telHref };
  }
  if (raw.ok === false && str(raw.error)) return { ok: false, error: raw.error };
  return null;
}

function parseIntent(raw: unknown): PayIntent | null {
  if (!isRecord(raw)) return null;
  if (!str(raw.id) || !str(raw.state) || !str(raw.paymentType)) return null;
  if (typeof raw.amountMinor !== "number" || !Number.isFinite(raw.amountMinor)) return null;
  return {
    id: raw.id,
    state: raw.state,
    paymentType: raw.paymentType,
    provider: strOrNull(raw.provider),
    currency: str(raw.currency) ? raw.currency : "RWF",
    amountMinor: raw.amountMinor,
    recipientName: strOrNull(raw.recipientName),
    recipientMasked: strOrNull(raw.recipientMasked),
    merchantCode: strOrNull(raw.merchantCode),
    expiresAt: strOrNull(raw.expiresAt),
    instruction: parseInstruction(raw.instruction),
  };
}

export type PayConfigResult =
  | ({ ok: true } & PayConfig)
  | ({ ok: false } & BearerFailure);

export function parseConfigResponse(status: number, body: unknown): PayConfigResult {
  if (status === 200 && isRecord(body) && body.ok === true && isRecord(body.config)) {
    return {
      ok: true,
      pay: body.config.pay === true,
      assistedPay: body.config.assistedPay === true,
      ussdDirectory: body.config.ussdDirectory === true,
      scanToPay: body.config.scanToPay === true,
    };
  }
  return { ok: false, ...failureForStatus(status, "Payments") };
}

export type PayIntentResult =
  | { ok: true; intent: PayIntent; existed: boolean }
  | { ok: false; reason: "not_found" | "unavailable" | "unauthorized" | "mfa_required" | "error"; message: string };

const NOT_FOUND = "That payment couldn't be found.";

/**
 * One parser for the create, read and handoff responses (all `{ ok, intent }`).
 * A 4xx with a user-safe `message` (a refused amount, a turned-off feature) is
 * passed through; anything else gets a generic line.
 */
export function parseIntentResponse(status: number, body: unknown): PayIntentResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    if (body.intent === null) {
      const gone = body.reason === "unavailable";
      return { ok: false, reason: gone ? "unavailable" : "not_found", message: gone ? "Payments aren't available yet." : NOT_FOUND };
    }
    const intent = parseIntent(body.intent);
    if (intent) return { ok: true, intent, existed: body.existed === true };
    return { ok: false, reason: "error", message: "The payment response wasn't understood." };
  }
  if (status === 404 && isRecord(body) && body.error === "not_found") {
    return { ok: false, reason: "not_found", message: NOT_FOUND };
  }
  if ((status === 403 || status === 422) && isRecord(body) && body.ok === false && str(body.message)) {
    return { ok: false, reason: "error", message: body.message };
  }
  const f = failureForStatus(status, "That payment");
  return { ok: false, reason: f.reason, message: f.message };
}
