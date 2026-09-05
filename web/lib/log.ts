// The one structured-logging convention for the Next side of OneLedger:
// route handlers (especially app/api/cron/*), server actions, and
// server-only services. Emits exactly one JSON object per line to
// stdout/stderr so a log drain can index it without a parser, and runs
// every field through a redaction pass so a caller can never accidentally
// log a secret, token, PIN/OTP, credential, or raw provider message.
//
// This is deliberately NOT a tracing SDK. It has no transport, no batching,
// no sampling - just a stable shape (audit F10 / assessment §5.1, §13):
//
//   { ts, stage, outcome, duration_ms?, retry_count?, request_id?,
//     correlation_id?, workspace?, source?, adapter?, ...safe fields }
//
// `workspace` / `source` are opaque surrogates the CALLER chooses to pass
// (a UUID is fine - it is an identifier, not a secret); this module never
// resolves or fetches tenant data. Operational aggregates and SLOs still
// come from get_operational_health_snapshot(); these lines are for
// after-the-fact debugging and for building a scheduler heartbeat from
// `stage:"cron.*"` start/ok/error events.
//
// Mirror of supabase/functions/_shared/log.ts (same shape, Deno side) -
// keep the two in step.

export type LogOutcome =
  | "start"
  | "ok"
  | "skipped"
  | "error"
  | "retry";

export type LogFields = Record<string, unknown>;

export type LogLine = {
  ts: string;
  stage: string;
  outcome: LogOutcome;
} & LogFields;

const REDACTED = "[redacted]";

// A key whose name alone means "never log the value". Matched
// case-insensitively as a substring of the (snake/camel/kebab) key.
const SENSITIVE_KEY =
  /secret|token|password|passwd|credential|cookie|authorization|bearer|api[_-]?key|access[_-]?key|private[_-]?key|signing[_-]?key|\bpin\b|\botp\b|passcode|session[_-]?id|raw_message|raw_payload|message_body|sms_body/i;

// A value that looks like one of this project's opaque secrets regardless
// of the key it arrived under (pairing tokens `olp_…`, device secrets
// `pfe_…`, JWTs, long hex/base64 blobs).
const SENSITIVE_VALUE =
  /^(olp_|pfe_|sk_|rk_|Bearer\s|eyJ[A-Za-z0-9_-]{10,}\.)|^[A-Fa-f0-9]{48,}$/;

export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return SENSITIVE_VALUE.test(value) ? REDACTED : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  // functions, symbols, bigint, etc. - never useful in a log line
  return String(value);
}

/**
 * Build the structured line without emitting it. Exposed for tests and for
 * callers that want to attach it to an HTTP response as well as the log.
 */
export function buildLogLine(
  stage: string,
  outcome: LogOutcome,
  fields: LogFields = {},
  now: Date = new Date(),
): LogLine {
  const safe = redact(fields) as LogFields;
  // ts/stage/outcome are structural and always win over a same-named field.
  return { ...safe, ts: now.toISOString(), stage, outcome };
}

/**
 * Emit one structured line. `error` outcomes go to stderr, everything else
 * to stdout, so existing error-only log filters keep working.
 */
export function logEvent(
  stage: string,
  outcome: LogOutcome,
  fields: LogFields = {},
): void {
  const line = JSON.stringify(buildLogLine(stage, outcome, fields));
  if (outcome === "error") console.error(line);
  else console.log(line);
}

/** A fresh correlation id for one request / one scheduled tick. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Wrap a unit of work (a cron tick, a job) so it always emits a
 * `start` then an `ok` (with `duration_ms`) or `error` line under one
 * correlation id. Re-throws so the caller's own error handling is
 * unchanged.
 */
export async function withLoggedRun<T>(
  stage: string,
  fields: LogFields,
  run: (ctx: { correlationId: string }) => Promise<T>,
): Promise<T> {
  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  logEvent(stage, "start", { ...fields, correlation_id: correlationId });
  try {
    const result = await run({ correlationId });
    logEvent(stage, "ok", {
      ...fields,
      correlation_id: correlationId,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    logEvent(stage, "error", {
      ...fields,
      correlation_id: correlationId,
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
