// Pure, dependency-free helpers for the device pairing v2 / capture surface.
// No Deno APIs beyond Web Crypto, no Supabase client - so capture/handler.ts
// can be unit-tested with fakes exactly like ingest-momo/connection-resolver.ts.

export const PAIRING_ERROR_CODES = [
  "PAIRING_INVALID",
  "PAIRING_EXPIRED",
  "PAIRING_ALREADY_USED",
  "PAIRING_BAD_CREDENTIAL",
  "PAIRING_NO_ROUTE",
] as const;

export type PairingErrorCode = (typeof PAIRING_ERROR_CODES)[number];

export type DeviceAuthErrorCode =
  | "INVALID_DEVICE_CREDENTIAL"
  | "DEVICE_REVOKED";

export type CaptureErrorCode = "INVALID_CAPTURE_PAYLOAD";

/**
 * Maps a database PAIRING_* reason code to the HTTP status the capture
 * endpoint returns. Unknown codes fall back to 400 - never 200.
 */
export function mapPairingReasonToHttp(code: string): number {
  switch (code) {
    case "PAIRING_EXPIRED":
      return 410;
    case "PAIRING_ALREADY_USED":
      return 409;
    case "PAIRING_INVALID":
    case "PAIRING_BAD_CREDENTIAL":
    case "PAIRING_NO_ROUTE":
      return 400;
    default:
      return 400;
  }
}

/**
 * The PostgREST error surface only gives us `message`. consume_device_pairing_session
 * raises the bare code as the message, so recovering it is a whole-string match.
 */
export function extractPairingErrorCode(
  message: string | null | undefined,
): PairingErrorCode | null {
  if (!message) return null;
  for (const code of PAIRING_ERROR_CODES) {
    if (message === code || message.includes(code)) return code;
  }
  return null;
}

export const CAPTURE_LIMITS = {
  messageMaxChars: 2000,
  clientVersionPattern: /^\d+\.\d+\.\d+$/,
  metadataMaxBytes: 1024,
  // A device-received timestamp older than this, or in the future beyond a
  // day of clock skew, is not a real transaction SMS.
  receivedAtMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  receivedAtMaxSkewMs: 24 * 60 * 60 * 1000,
} as const;

// The pairing token the web app generates: olp_<4-char display prefix><body>.
export const PAIRING_TOKEN_PATTERN = /^olp_[A-Za-z0-9]{4}[A-Za-z0-9_-]{16,}$/;
// The device secret the Shortcut generates: reuses the existing pfe_ family so
// device_credentials.credential_prefix keeps one shape across the codebase.
export const DEVICE_SECRET_PATTERN = /^pfe_[A-Za-z0-9_-]{20,}$/;
export const DEVICE_SECRET_PREFIX_PATTERN = /^pfe_[A-Za-z0-9_-]{4}$/;

export type CaptureEnvelope = {
  message: string | null;
  received_at: string;
  client_version: string;
  metadata: Record<string, unknown>;
  test: boolean;
};

export type CaptureEnvelopeResult =
  | { ok: true; value: CaptureEnvelope }
  | { ok: false; code: CaptureErrorCode; reason: string };

const ALLOWED_ENVELOPE_KEYS = new Set([
  "op",
  "message",
  "received_at",
  "client_version",
  "metadata",
  "device_id",
]);

/**
 * Validates the universal capture envelope. `requireMessage` is false for the
 * `test` op (a test may carry a sample message or none). Never trusts a value
 * just because the device authenticated.
 */
export function validateCaptureEnvelope(
  input: unknown,
  now: Date,
  opts: { requireMessage: boolean },
): CaptureEnvelopeResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      code: "INVALID_CAPTURE_PAYLOAD",
      reason: "not_an_object",
    };
  }
  const body = input as Record<string, unknown>;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(key)) {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "unknown_field",
      };
    }
  }

  const rawMessage = body.message;
  let message: string | null = null;
  if (rawMessage !== undefined && rawMessage !== null) {
    if (typeof rawMessage !== "string") {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "message_type",
      };
    }
    const trimmed = rawMessage.trim();
    if (
      trimmed.length === 0 || trimmed.length > CAPTURE_LIMITS.messageMaxChars
    ) {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "message_length",
      };
    }
    message = rawMessage;
  }
  if (opts.requireMessage && message === null) {
    return {
      ok: false,
      code: "INVALID_CAPTURE_PAYLOAD",
      reason: "message_required",
    };
  }

  if (
    typeof body.client_version !== "string" ||
    !CAPTURE_LIMITS.clientVersionPattern.test(body.client_version)
  ) {
    return {
      ok: false,
      code: "INVALID_CAPTURE_PAYLOAD",
      reason: "client_version",
    };
  }

  const receivedRaw = body.received_at;
  let receivedIso: string;
  if (receivedRaw === undefined || receivedRaw === null) {
    receivedIso = now.toISOString();
  } else {
    if (typeof receivedRaw !== "string") {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "received_at_type",
      };
    }
    const parsed = Date.parse(receivedRaw);
    if (Number.isNaN(parsed)) {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "received_at_format",
      };
    }
    const delta = parsed - now.getTime();
    if (
      delta > CAPTURE_LIMITS.receivedAtMaxSkewMs ||
      -delta > CAPTURE_LIMITS.receivedAtMaxAgeMs
    ) {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "received_at_range",
      };
    }
    receivedIso = new Date(parsed).toISOString();
  }

  let metadata: Record<string, unknown> = {};
  if (body.metadata !== undefined && body.metadata !== null) {
    if (
      typeof body.metadata !== "object" || Array.isArray(body.metadata)
    ) {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "metadata_type",
      };
    }
    const serialized = JSON.stringify(body.metadata);
    if (
      new TextEncoder().encode(serialized).length >
        CAPTURE_LIMITS.metadataMaxBytes
    ) {
      return {
        ok: false,
        code: "INVALID_CAPTURE_PAYLOAD",
        reason: "metadata_size",
      };
    }
    metadata = body.metadata as Record<string, unknown>;
  }

  const test = metadata.test === true;

  return {
    ok: true,
    value: {
      message,
      received_at: receivedIso,
      client_version: body.client_version,
      metadata,
      test,
    },
  };
}

/** Lowercase hex SHA-256, matching the database's `^[0-9a-f]{64}$` columns. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type RateDecision = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Minimal fixed-window in-memory limiter. Per-isolate only - a coarse first
 * line of defence in front of the DB, not a distributed quota.
 */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string, now = Date.now()): RateDecision {
      const entry = hits.get(key);
      if (!entry || now >= entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + opts.windowMs });
        return { ok: true };
      }
      if (entry.count >= opts.max) {
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        };
      }
      entry.count += 1;
      return { ok: true };
    },
  };
}
