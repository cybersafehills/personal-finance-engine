import { failureForStatus, type BearerFailure } from "@/api/bearer";
import { parseWriteFailure, type WriteFailure } from "@/features/spaces/members-parse";

import type { Rule } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function parseRule(raw: unknown): Rule | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.title) || !str(raw.categoryLabel)) return null;
  if (!str(raw.summary) || typeof raw.active !== "boolean") return null;
  if (!str(raw.originLabel) || !str(raw.matchedLabel)) return null;
  return {
    id: raw.id,
    title: raw.title,
    categoryLabel: raw.categoryLabel,
    summary: raw.summary,
    active: raw.active,
    originLabel: raw.originLabel,
    scopeLabel: str(raw.scopeLabel) ? raw.scopeLabel : null,
    matchedLabel: raw.matchedLabel,
  };
}

export type RulesResult = { ok: true; rules: Rule[] } | ({ ok: false } & BearerFailure);

export function parseRulesResponse(status: number, body: unknown): RulesResult {
  if (status === 200 && isRecord(body) && body.ok === true && Array.isArray(body.rules)) {
    return { ok: true, rules: body.rules.map(parseRule).filter((r): r is Rule => r !== null) };
  }
  if (status === 200) return { ok: false, reason: "error", message: "The rules response wasn't understood." };
  return { ok: false, ...failureForStatus(status, "Your rules") };
}

export type SetActiveResult = { ok: true; rule: Rule } | WriteFailure;

/** The server answers with the rule as it now is, so the screen never guesses. */
export function parseSetActiveResponse(status: number, body: unknown): SetActiveResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const rule = parseRule(body.rule);
    if (rule) return { ok: true, rule };
    return { ok: false, reason: "error", message: "That change wasn't confirmed. Check the list and try again." };
  }
  return parseWriteFailure(status, body);
}
