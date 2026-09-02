// Pure, explainable duplicate-matching for a normalized import row against
// existing ledger transactions. Produces a confidence tier plus the
// signals that led to it, so the review UI can say *why* a row looks like
// a duplicate. This is advisory: commit_import_batch independently sets
// dedupe_state from the Space fingerprint. Never used to auto-merge.

import type { NormalizedImportRow } from "./mapping";
import type { MatchConfidence } from "./model";

export type CandidateTransaction = {
  id: string;
  amountMinor: number;
  currency: string | null;
  direction: "in" | "out" | "neutral";
  occurredAt: string;
  counterparty: string | null;
  externalId: string | null;
  externalReference: string | null;
};

export type MatchSignal = {
  code: string;
  label: string;
  weight: number;
};

export type RowMatch = {
  confidence: MatchConfidence;
  score: number;
  bestCandidateId: string | null;
  signals: MatchSignal[];
};

const EXACT_TIME_MS = 2 * 60 * 1000; // same minute-ish
const SAME_DAY_MS = 24 * 60 * 60 * 1000;

function norm(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Cheap token overlap of two counterparty strings, 0..1. */
function textOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

function scoreAgainst(
  row: NormalizedImportRow,
  candidate: CandidateTransaction,
): { score: number; signals: MatchSignal[] } {
  const signals: MatchSignal[] = [];
  const rowId = norm(row.external_transaction_id);
  const rowRef = norm(row.external_reference);
  const rowParty = norm(row.merchant ?? row.description);
  const candParty = norm(candidate.counterparty);

  const amountEqual = row.amount_minor === candidate.amountMinor &&
    (!row.currency || !candidate.currency ||
      row.currency === candidate.currency) &&
    row.direction === candidate.direction;

  const dt = Math.abs(
    Date.parse(row.occurred_at) - Date.parse(candidate.occurredAt),
  );

  if (rowId && candidate.externalId && rowId === norm(candidate.externalId)) {
    signals.push({ code: "external_id", label: "Same transaction ID", weight: 1 });
  }
  if (rowRef && candidate.externalReference &&
    rowRef === norm(candidate.externalReference)) {
    signals.push({ code: "reference", label: "Same reference", weight: 0.7 });
  }
  if (amountEqual && dt <= EXACT_TIME_MS) {
    signals.push({
      code: "amount_time",
      label: "Same amount, direction and time",
      weight: 0.8,
    });
  } else if (amountEqual && dt <= SAME_DAY_MS) {
    signals.push({
      code: "amount_day",
      label: "Same amount and direction, same day",
      weight: 0.45,
    });
  }
  if (amountEqual && rowParty && textOverlap(rowParty, candParty) >= 0.6) {
    signals.push({
      code: "party",
      label: "Similar counterparty and same amount",
      weight: 0.35,
    });
  }

  const score = Math.min(1, signals.reduce((sum, s) => sum + s.weight, 0));
  return { score, signals };
}

function tier(score: number): MatchConfidence {
  if (score >= 0.9) return "exact";
  if (score >= 0.6) return "likely";
  if (score >= 0.3) return "possible";
  return "distinct";
}

/** Match one normalized row against a candidate pool. */
export function matchNormalizedRow(
  row: NormalizedImportRow,
  candidates: CandidateTransaction[],
): RowMatch {
  let best: { score: number; signals: MatchSignal[]; id: string } | null = null;
  for (const candidate of candidates) {
    const { score, signals } = scoreAgainst(row, candidate);
    if (!best || score > best.score) {
      best = { score, signals, id: candidate.id };
    }
  }
  if (!best || best.score === 0) {
    return { confidence: "distinct", score: 0, bestCandidateId: null, signals: [] };
  }
  return {
    confidence: tier(best.score),
    score: Number(best.score.toFixed(3)),
    bestCandidateId: best.id,
    signals: best.signals,
  };
}

/** A match tier at/above which the row should not be committed without review. */
export function isReviewWorthy(confidence: MatchConfidence): boolean {
  return confidence === "exact" || confidence === "likely";
}
