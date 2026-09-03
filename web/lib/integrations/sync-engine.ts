// Pure retry / backoff policy for integration_sync_runs. No IO - the
// cron and runWorkbookSync apply the state this returns.

export const MAX_SYNC_ATTEMPTS = 5;
const BASE_DELAY_SECONDS = 60;
const MAX_DELAY_SECONDS = 3600;

export type FailureClass = "transient" | "permanent" | "needs_auth";

/** Map an error code to how the sync engine should treat it. */
export function classifyFailure(code: string | null | undefined): FailureClass {
  switch (code) {
    case "needs_auth":
    case "oauth_exchange_failed":
    case "no_secret":
    case "bad_token":
      return "needs_auth";
    case "provider_not_configured":
    case "provider_upload_not_implemented":
    case "unsafe_url":
    case "unknown_provider":
    case "http_4xx":
      return "permanent";
    // network blips, 5xx, timeouts, transient write failures
    default:
      return "transient";
  }
}

/** Deterministic exponential backoff (no jitter, so it's testable). */
export function backoffSeconds(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(BASE_DELAY_SECONDS * 2 ** n, MAX_DELAY_SECONDS);
}

export type NextAttemptState = {
  status: "queued" | "failed";
  attempt: number;
  nextAttemptAtMs: number | null;
  /** true when the owning destination/workbook should be flipped to needs_auth. */
  markNeedsAuth: boolean;
};

/**
 * Given the just-failed run's attempt count and error code, decide
 * whether to schedule another try or give up.
 */
export function nextAttemptState(
  currentAttempt: number,
  code: string | null | undefined,
  nowMs: number,
): NextAttemptState {
  const klass = classifyFailure(code);
  const attempt = Math.max(0, Math.floor(currentAttempt));

  if (klass === "needs_auth") {
    return { status: "failed", attempt, nextAttemptAtMs: null, markNeedsAuth: true };
  }
  if (klass === "permanent" || attempt + 1 >= MAX_SYNC_ATTEMPTS) {
    return { status: "failed", attempt: attempt + 1, nextAttemptAtMs: null, markNeedsAuth: false };
  }
  return {
    status: "queued",
    attempt: attempt + 1,
    nextAttemptAtMs: nowMs + backoffSeconds(attempt + 1) * 1000,
    markNeedsAuth: false,
  };
}
