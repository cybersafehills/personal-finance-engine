// The one structured-logging convention for OneLedger's Edge Functions
// (ingest-momo, capture, process-raw-events, reconcile-balances,
// send-notifications). Emits exactly one JSON object per line so a log
// drain can index it without a parser, and runs every field through a
// redaction pass so a caller can never accidentally log a secret, token,
// PIN/OTP, credential, device secret, or raw provider message.
//
// Not a tracing SDK - no transport, no batching, no sampling. Just a
// stable shape (audit F10 / assessment sections 5.1 and 13):
//
//   { ts, stage, outcome, duration_ms?, retry_count?, request_id?,
//     correlation_id?, workspace?, source?, adapter?, ...safe fields }
//
// `workspace` / `source` are opaque surrogates the CALLER passes; this
// module never resolves or fetches tenant data. Operational aggregates
// and SLOs still come from get_operational_health_snapshot().
//
// Mirror of web/lib/log.ts (same shape, Next side) - keep the two in step.

export type LogOutcome = "start" | "ok" | "skipped" | "error" | "retry";

export type LogFields = Record<string, unknown>;

export type LogLine = {
  ts: string;
  stage: string;
  outcome: LogOutcome;
} & LogFields;

const REDACTED = "[redacted]";

const SENSITIVE_KEY =
  /secret|token|password|passwd|credential|cookie|authorization|bearer|api[_-]?key|access[_-]?key|private[_-]?key|signing[_-]?key|\bpin\b|\botp\b|passcode|session[_-]?id|raw_message|raw_payload|message_body|sms_body/i;

const SENSITIVE_VALUE =
  /^(olp_|pfe_|sk_|rk_|Bearer\s|eyJ[A-Za-z0-9_-]{10,}\.)|^[A-Fa-f0-9]{48,}$/;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
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
  return String(value);
}

/** Build the structured line without emitting it. Exposed for tests. */
export function buildLogLine(
  stage: string,
  outcome: LogOutcome,
  fields: LogFields = {},
  now: Date = new Date(),
): LogLine {
  const safe = redact(fields) as LogFields;
  return { ...safe, ts: now.toISOString(), stage, outcome };
}

/**
 * Emit one structured line. `error` outcomes go to stderr, everything
 * else to stdout, so existing error-only log filters keep working.
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
