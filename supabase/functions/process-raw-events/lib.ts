// Pure helpers for the raw-events processor. index.ts wires these to the real
// Supabase client and the shared ingestion pipeline; the tests wire plain
// values.

import type { PipelineResult } from "../_shared/ingestion-pipeline.ts";

export function secretsEqual(
  presented: string | null,
  expected: string,
): boolean {
  if (!presented || presented.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Two gates, both required:
 *   DEVICE_PAIRING_V2 = "enabled"          - the capture channel this drains
 *   RAW_EVENTS_PROCESSOR_SECRET (>= 32ch)  - presented in X-Processor-Secret
 */
export function authorizeProcessorRequest(
  request: Request,
  get: (key: string) => string | undefined,
):
  | "ok"
  | "method_not_allowed"
  | "not_found"
  | "unauthorized"
  | "secret_not_configured" {
  if (request.method !== "POST") return "method_not_allowed";
  if (get("DEVICE_PAIRING_V2") !== "enabled") return "not_found";
  const expected = (get("RAW_EVENTS_PROCESSOR_SECRET") ?? "").trim();
  if (expected.length < 32) return "secret_not_configured";
  return secretsEqual(request.headers.get("x-processor-secret"), expected)
    ? "ok"
    : "unauthorized";
}

export type ParseStatusDecision = {
  /** Terminal state to stamp on raw_financial_events, or null to leave it. */
  parseStatus: "normalized" | "rejected" | "superseded" | "failed" | "pending";
  bucket: "processed" | "superseded" | "failed" | "retried";
};

/**
 * Maps a pipeline result onto the evidence row's lifecycle. `db_error` is
 * treated as transient (back to `pending`) until `attempts` hits the cap,
 * then it is parked as `failed` for inspection.
 */
export function decideParseStatus(
  result: PipelineResult,
  attempts: number,
  maxAttempts = 5,
): ParseStatusDecision {
  switch (result.status) {
    case "processed":
      // The pipeline already stamped `normalized` + canonical_transaction_id
      // best-effort; re-assert it so a row is never left in `processing`.
      return { parseStatus: "normalized", bucket: "processed" };
    case "duplicate_transaction":
      return { parseStatus: "superseded", bucket: "superseded" };
    case "needs_review":
    case "account_unavailable":
    case "accounting_failed":
      return { parseStatus: "failed", bucket: "failed" };
    case "db_error":
      return attempts + 1 >= maxAttempts
        ? { parseStatus: "failed", bucket: "failed" }
        : { parseStatus: "pending", bucket: "retried" };
  }
}
