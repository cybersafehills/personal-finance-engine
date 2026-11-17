import { failureForStatus, type BearerFailure } from "@/api/bearer";

import type { ClassifyResult, PrepareOutcome, ScanModel } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parseModel(m: unknown): ScanModel | null {
  if (!isRecord(m) || !isRecord(m.route)) return null;
  const cls = m.class;
  if (cls !== "verified_ussd" && cls !== "provider_link" && cls !== "oneledger_payment") return null;
  const r = m.route;
  let route: ScanModel["route"];
  if (r.kind === "ussd" && typeof r.template === "string") {
    route = { kind: "ussd", template: r.template, literal: text(r.literal) };
  } else if (r.kind === "provider_link" && typeof r.provider === "string" && typeof r.url === "string") {
    route = { kind: "provider_link", provider: r.provider, url: r.url };
  } else if (r.kind === "oneledger" && typeof r.merchantIdMasked === "string" && typeof r.currency === "string") {
    route = { kind: "oneledger", provider: text(r.provider), merchantIdMasked: r.merchantIdMasked, currency: r.currency };
  } else return null;

  const amount = isRecord(m.amount) && typeof m.amount.minor === "number" && typeof m.amount.currency === "string"
    ? { minor: m.amount.minor, currency: m.amount.currency }
    : null;
  return {
    class: cls,
    route,
    providerLabel: text(m.providerLabel),
    providerVerified: m.providerVerified === true,
    recipientMasked: text(m.recipientMasked),
    amount,
    amountEditable: m.amountEditable === true,
    reference: text(m.reference),
    warnings: Array.isArray(m.warnings) ? m.warnings.filter((w): w is string => typeof w === "string") : [],
  };
}

export type ClassifyResponse =
  | { ok: true; result: ClassifyResult }
  | ({ ok: false } & BearerFailure & { disabled: boolean });

export function parseClassifyResponse(status: number, body: unknown): ClassifyResponse {
  if (status === 200 && isRecord(body) && body.ok === true && isRecord(body.result)) {
    const res = body.result;
    if (res.ok === true) {
      const model = parseModel(res.model);
      if (model) return { ok: true, result: { ok: true, model } };
    } else if (res.ok === false && typeof res.reason === "string") {
      return { ok: true, result: { ok: false, class: text(res.class) ?? "unsupported", reason: res.reason } };
    }
  }
  const disabled = status === 403 && isRecord(body) && body.error === "feature_disabled";
  return { ok: false, disabled, ...failureForStatus(status, "That code") };
}

const STATUSES = ["prepared", "info_only", "unsupported", "amount_required", "currency_unsupported", "feature_disabled", "error"] as const;

export type PrepareResponse = { ok: true; outcome: PrepareOutcome } | ({ ok: false } & BearerFailure);

export function parsePrepareResponse(status: number, body: unknown): PrepareResponse {
  if (status === 200 && isRecord(body) && body.ok === true && isRecord(body.outcome)) {
    const o = body.outcome;
    const s = o.status;
    if (s === "prepared" && typeof o.intentId === "string" && typeof o.telHref === "string") {
      return { ok: true, outcome: { status: "prepared", intentId: o.intentId, telHref: o.telHref, existed: o.existed === true } };
    }
    if (s === "info_only" && typeof o.telHref === "string") {
      return { ok: true, outcome: { status: "info_only", telHref: o.telHref } };
    }
    if (typeof s === "string" && (STATUSES as readonly string[]).includes(s) && s !== "prepared" && s !== "info_only") {
      return { ok: true, outcome: { status: s as Exclude<PrepareOutcome["status"], "prepared" | "info_only"> } };
    }
  }
  return { ok: false, ...failureForStatus(status, "That payment") };
}
