import { failureForStatus } from "@/api/bearer";
import { parseIntent } from "@/features/pay/parse";
import type { PayIntent } from "@/features/pay/types";

import type { SaveOnNext, SaveOnOffer, SaveOnPlan, SaveOnPrefs, SaveOnThreshold } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const digits = (v: unknown): v is string => typeof v === "string" && /^\d{1,15}$/.test(v);
const digitsOrNull = (v: unknown): string | null => (digits(v) ? v : null);
const THRESHOLDS: readonly SaveOnThreshold[] = ["any", "balanced", "bigger"];

export type SaveOnFailure = {
  ok: false;
  reason: "unavailable" | "unauthorized" | "mfa_required" | "error";
  /** The server's machine code on a 409/422 (waiting, blocked, stopped, no_split...), else null. */
  code: string | null;
  message: string;
};
export type SaveOnResult<T> = ({ ok: true } & T) | SaveOnFailure;

/** A 4xx with a user-safe `message` is passed through; anything else gets a generic line. */
export function failureOf(status: number, body: unknown, what = "Save On"): SaveOnFailure {
  if ((status === 403 || status === 404 || status === 409 || status === 422) && isRecord(body) && body.ok === false && typeof body.message === "string" && body.message) {
    const feature = status === 403 && body.error === "feature_disabled";
    return { ok: false, reason: feature ? "unavailable" : "error", code: typeof body.error === "string" ? body.error : null, message: body.message };
  }
  const f = failureForStatus(status, what);
  return { ok: false, reason: f.reason, code: null, message: f.message };
}

function parseOffer(raw: unknown): SaveOnOffer | null {
  if (!isRecord(raw)) return null;
  if (raw.kind !== "capacity" && raw.kind !== "fee_saving") return null;
  if (!digits(raw.totalMinor) || !Array.isArray(raw.parts) || raw.parts.length < 2) return null;
  const parts: SaveOnOffer["parts"] = [];
  for (const p of raw.parts) {
    if (!isRecord(p) || typeof p.index !== "number" || !digits(p.amountMinor)) return null;
    parts.push({ index: p.index, amountMinor: p.amountMinor, feeMinor: digitsOrNull(p.feeMinor) });
  }
  const src = isRecord(raw.source) && typeof raw.source.label === "string"
    ? { label: raw.source.label, url: typeof raw.source.url === "string" ? raw.source.url : null, asOf: typeof raw.source.asOf === "string" ? raw.source.asOf : null }
    : null;
  return {
    kind: raw.kind,
    networkSlug: typeof raw.networkSlug === "string" ? raw.networkSlug : null,
    totalMinor: raw.totalMinor,
    parts,
    singleFeeMinor: digitsOrNull(raw.singleFeeMinor),
    plannedFeeMinor: digitsOrNull(raw.plannedFeeMinor),
    savingsMinor: digitsOrNull(raw.savingsMinor),
    feeBasis: raw.feeBasis === "verified_tariff" || raw.feeBasis === "published_maximum" ? raw.feeBasis : "none",
    capacityMinor: digitsOrNull(raw.capacityMinor),
    source: src,
  };
}

/** `offer: null` is a normal answer: this payment goes as one transfer. */
export function parseOfferResponse(status: number, body: unknown): SaveOnResult<{ offer: SaveOnOffer | null }> {
  if (status === 200 && isRecord(body) && body.ok === true) {
    if (body.offer === null || body.offer === undefined) return { ok: true, offer: null };
    const offer = parseOffer(body.offer);
    // A response we can't read is "no offer", never a guessed one.
    return { ok: true, offer };
  }
  return failureOf(status, body);
}

function parseNext(raw: unknown): SaveOnNext | null {
  if (!isRecord(raw)) return null;
  if (raw.status === "complete" || raw.status === "stopped") return { status: raw.status };
  if ((raw.status === "ready" || raw.status === "waiting" || raw.status === "blocked") && typeof raw.index === "number" && digits(raw.amountMinor)) {
    return { status: raw.status, index: raw.index, amountMinor: raw.amountMinor };
  }
  return null;
}

function parsePlan(raw: unknown): SaveOnPlan | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !digits(raw.totalMinor)) return null;
  if (raw.kind !== "capacity" && raw.kind !== "fee_saving") return null;
  if (!Array.isArray(raw.plannedPartsMinor) || !raw.plannedPartsMinor.every(digits) || !Array.isArray(raw.parts)) return null;
  const next = parseNext(raw.next);
  if (!next) return null;
  const parts: SaveOnPlan["parts"] = [];
  for (const p of raw.parts) {
    if (!isRecord(p) || typeof p.index !== "number" || typeof p.intentId !== "string" || !digits(p.amountMinor) || typeof p.state !== "string") return null;
    parts.push({ index: p.index, intentId: p.intentId, amountMinor: p.amountMinor, state: p.state });
  }
  return {
    id: raw.id,
    kind: raw.kind,
    totalMinor: raw.totalMinor,
    plannedPartsMinor: raw.plannedPartsMinor as string[],
    feeBasis: raw.feeBasis === "verified_tariff" || raw.feeBasis === "published_maximum" ? raw.feeBasis : "none",
    stopped: raw.stopped === true,
    parts,
    next,
    remainingMinor: digits(raw.remainingMinor) ? raw.remainingMinor : "0",
  };
}

export function parsePlanResponse(status: number, body: unknown): SaveOnResult<{ plan: SaveOnPlan }> {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const plan = parsePlan(body.plan);
    if (plan) return { ok: true, plan };
    return { ok: false, reason: "error", code: null, message: "The split wasn't understood." };
  }
  return failureOf(status, body, "That split");
}

/** Start and next both answer with the part's payment; both are `{ planId, intent }`. */
export function parsePartResponse(status: number, body: unknown): SaveOnResult<{ planId: string; intent: PayIntent; index: number | null }> {
  if (status === 200 && isRecord(body) && body.ok === true && typeof body.planId === "string") {
    const intent = parseIntent(body.intent);
    if (intent) return { ok: true, planId: body.planId, intent, index: typeof body.index === "number" ? body.index : null };
    return { ok: false, reason: "error", code: null, message: "The payment response wasn't understood." };
  }
  return failureOf(status, body, "That payment");
}

export function parseStopResponse(status: number, body: unknown): SaveOnResult<Record<never, never>> {
  if (status === 200 && isRecord(body) && body.ok === true && body.stopped === true) return { ok: true };
  return failureOf(status, body, "That split");
}

export function parsePrefsResponse(status: number, body: unknown): SaveOnResult<{ preferences: SaveOnPrefs }> {
  if (status === 200 && isRecord(body) && body.ok === true && isRecord(body.preferences)) {
    const p = body.preferences;
    const threshold = THRESHOLDS.find((t) => t === p.threshold);
    if (typeof p.feeSavingEnabled === "boolean" && threshold) {
      return { ok: true, preferences: { feeSavingEnabled: p.feeSavingEnabled, threshold } };
    }
  }
  return failureOf(status, body);
}
