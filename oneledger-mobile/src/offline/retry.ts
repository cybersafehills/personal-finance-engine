// Failure taxonomy and bounded exponential backoff with full jitter.
//
//   network    no usable connection / timeout   -> retry later, free of penalty
//   server     5xx, unknown                     -> retry with backoff, bounded
//   auth       token expired / not signed in    -> stop; resume after sign-in
//   conflict   server says the record changed   -> hold for the user
//   permanent  validation / permission refused  -> never retried automatically
//
// A refusal never deletes the local record; it only stops automatic retries.

export type FailureKind = "network" | "server" | "auth" | "conflict" | "permanent";

export class TransportError extends Error {
  constructor(
    readonly kind: FailureKind,
    /** A stable, non-sensitive code (never payload contents). */
    readonly code: string,
  ) {
    super(code);
    this.name = "TransportError";
  }
}

export const MAX_SERVER_ATTEMPTS = 8;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 15 * 60_000;

/** Full-jitter backoff: uniform in [0, min(cap, base * 2^attempts)). */
export function backoffDelayMs(attempts: number, random: () => number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts));
  return Math.floor(random() * ceiling);
}

const PERMANENT_CODES = new Set([
  "not_found_or_forbidden",
  "invalid_transaction_type",
  "invalid_direction",
  "invalid_amount",
  "invalid_fee",
  "invalid_time",
  "invalid_text",
  "invalid_operation",
  "op_id_conflict",
  "entity_exists",
]);

/** Maps a Supabase/PostgREST-style error into the taxonomy above. */
export function classifyError(input: {
  status?: number;
  message?: string;
  code?: string;
  networkFailure?: boolean;
}): TransportError {
  const message = (input.message ?? "").toLowerCase();
  for (const code of PERMANENT_CODES) {
    if (message.includes(code)) return new TransportError("permanent", code);
  }
  if (message.includes("not_authenticated") || message.includes("jwt") || input.status === 401) {
    return new TransportError("auth", "auth_expired");
  }
  if (input.status === 403) return new TransportError("permanent", "forbidden");
  if (input.status === 409) return new TransportError("conflict", "version_conflict");
  if (input.status === 400 || input.status === 422) return new TransportError("permanent", "invalid_payload");
  if (
    input.networkFailure ||
    /network|failed to fetch|timeout|timed out|offline|aborted/.test(message)
  ) {
    return new TransportError("network", "network_unreachable");
  }
  return new TransportError("server", input.status ? `server_${input.status}` : "server_error");
}
