// Device pairing v2 - the web side of the one-time pairing handshake.
//
// Pure and env-free (no `server-only`), so it is type-checked by
// `deno test web/lib` and can be imported by a client component. The Server
// Action that calls `create_device_pairing_session` (a later PR) uses
// `generatePairingToken()` here, stores only `hashPairingToken(token)`, and
// shows the plaintext token to the user exactly once.
//
// Contract mirrors:
//   - DB:   pairing_sessions.token_hash `^[0-9a-f]{64}$`,
//           pairing_sessions.token_prefix `^olp_[A-Za-z0-9]{4}$`
//           (supabase/migrations/20261104000000_device_pairing_v2.sql)
//   - Edge: PAIRING_TOKEN_PATTERN, mapPairingReasonToHttp
//           (supabase/functions/_shared/pairing.ts)

const DISPLAY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648

export const PAIRING_TOKEN_PREFIX = "olp_";

/** Must accept every token `generatePairingToken` produces; mirrors the Edge check. */
export const PAIRING_TOKEN_PATTERN = /^olp_[A-Za-z0-9]{4}[A-Za-z0-9_-]{16,}$/;

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export type GeneratedPairingToken = {
  /** Shown to the user once, sent by the device on `op:"pair"`. Never stored. */
  token: string;
  /** `olp_` + 4 display chars. Safe to persist and render (`pairing_sessions.token_prefix`). */
  prefix: string;
};

/**
 * A 128-bit single-use pairing token. Shape: `olp_` + 4 display chars +
 * 26 base32 chars. The display chars double as the human-readable code
 * fragment the wizard shows next to a QR handoff.
 */
export function generatePairingToken(): GeneratedPairingToken {
  const display = Array.from(
    randomBytes(4),
    (b) => DISPLAY_ALPHABET[b % DISPLAY_ALPHABET.length],
  ).join("");
  const body = base32(randomBytes(16)); // 128 bits -> 26 chars
  const prefix = `${PAIRING_TOKEN_PREFIX}${display}`;
  return { token: `${prefix}${body}`, prefix };
}

/** Lowercase hex SHA-256 - the value written to `pairing_sessions.token_hash`. */
export async function hashPairingToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `olp_ABCD` from a full token, or `null` if it is not a pairing token. */
export function pairingTokenPrefix(token: string): string | null {
  return PAIRING_TOKEN_PATTERN.test(token) ? token.slice(0, 8) : null;
}

/**
 * Non-technical, action-oriented copy for every error the capture endpoint
 * can return during pairing or the connection test. Keyed by the machine
 * `error` string in the response body.
 */
export const PAIRING_ERROR_COPY: Record<string, string> = {
  PAIRING_INVALID:
    "That pairing code wasn't recognised. Start the connection again to get a new one.",
  PAIRING_EXPIRED:
    "This pairing code has expired. Codes last about 10 minutes - start again for a fresh one.",
  PAIRING_ALREADY_USED:
    "This pairing code has already been used. Start the connection again if you need to pair another phone.",
  PAIRING_BAD_CREDENTIAL:
    "Something went wrong setting up this phone's secure key. Try pairing again.",
  PAIRING_NO_ROUTE:
    "Choose which account this phone should send transactions to, then try again.",
  INVALID_DEVICE_CREDENTIAL:
    "This phone isn't connected to OneLedger any more. Reconnect it to keep capturing transactions.",
  DEVICE_REVOKED:
    "This phone was disconnected. Reconnect it to start capturing transactions again.",
  INVALID_CAPTURE_PAYLOAD:
    "OneLedger couldn't read what your phone sent. Update the OneLedger Capture Shortcut and try again.",
  RATE_LIMITED:
    "Too many attempts in a short time. Wait a minute and try again.",
};

export function pairingErrorMessage(code: string | null | undefined): string {
  if (code && code in PAIRING_ERROR_COPY) return PAIRING_ERROR_COPY[code];
  return "Something went wrong. Please try again in a moment.";
}

/** Fail-closed gate for the pairing wizard - same env var the `capture` Edge Function reads. */
export function devicePairingV2Enabled(value: string | undefined): boolean {
  return value === "enabled";
}

/**
 * `accounts.provider` -> the connector adapter contract key. Mirrors the CASE
 * in `backfill_legacy_ingestion_connection`
 * (supabase/migrations/20261012000000_connector_model_stage_b_backfill.sql), so
 * a pairing session's `connector_key` lines up with what enrollment will stamp.
 */
export function connectorKeyForProvider(provider: string): string {
  switch (provider) {
    case "mtn_momo":
      return "mtn_momo_sms_v1";
    case "airtel_money":
      return "airtel_money_sms_v1";
    case "bank":
      return "bank_legacy_push_v1";
    default:
      return "generic_legacy_push_v1";
  }
}

export const PAIR_HANDOFF_QUERY = "c";
export const PAIR_HANDOFF_PLATFORM_QUERY = "p";

/** Which kind of phone the wizard is pairing. Drives copy, the install guide,
 *  and which deep link the Pair step / `/pair` handoff offers. */
export type PairPlatform = "ios" | "android";

export function isPairPlatform(value: unknown): value is PairPlatform {
  return value === "ios" || value === "android";
}

/**
 * Path of the public cross-device handoff page for a pairing token. `ios` is
 * the default and adds no query param, so existing links stay byte-stable;
 * `android` appends `&p=android` so `/pair` can offer the Companion deep link
 * instead of the Shortcut one.
 */
export function pairHandoffPath(
  token: string,
  platform: PairPlatform = "ios",
): string {
  const base = `/pair?${PAIR_HANDOFF_QUERY}=${encodeURIComponent(token)}`;
  return platform === "android"
    ? `${base}&${PAIR_HANDOFF_PLATFORM_QUERY}=android`
    : base;
}

/** Absolute handoff URL to encode into the desktop wizard's QR code. */
export function pairHandoffUrl(
  origin: string,
  token: string,
  platform: PairPlatform = "ios",
): string {
  return `${origin.replace(/\/+$/, "")}${pairHandoffPath(token, platform)}`;
}

export const ANDROID_COMPANION_PACKAGE = "me.oneledger.companion";

/**
 * `oneledger://pair?c=<token>` — matches the OneLedger Companion's
 * AndroidManifest intent filter (scheme `oneledger`, host `pair`). Opens the
 * app straight onto the pairing screen with the code prefilled. A harmless
 * no-op when the app isn't installed (same tradeoff as
 * `devicePairShortcutRunUrl` on iOS); the wizard's poll is what actually
 * advances the flow, however the token reaches the device.
 */
export function androidCompanionPairUrl(token: string): string {
  return `oneledger://pair?${PAIR_HANDOFF_QUERY}=${encodeURIComponent(token)}`;
}

/** The Messages-automation forwarder (Shortcut B). Not the pairing Shortcut. */
export const CAPTURE_SHORTCUT_NAME = "OneLedger Capture";
/** The one-time pairing Shortcut (Shortcut A) — runs op:"pair" with the code. */
export const CONNECT_SHORTCUT_NAME = "Connect to OneLedger";

/**
 * `shortcuts://run-shortcut?...` deep link that runs the one-time
 * "Connect to OneLedger" Shortcut on this iPhone, passing the pairing token as
 * its text input. Two things the Shortcuts URL scheme is strict about:
 *
 *  - It opens the *pairing* Shortcut, not "OneLedger Capture" — that one is the
 *    Messages-automation forwarder and has no pairing step.
 *  - Spaces in the name must be percent-encoded as %20. The scheme does NOT
 *    treat "+" as a space, so a `URLSearchParams`-built query
 *    ("Connect+to+OneLedger") makes iOS report "the file doesn't exist".
 *
 * A harmless no-op on a desktop browser — the wizard's poll is what actually
 * advances the flow, however the token reaches the device.
 */
export function devicePairShortcutRunUrl(
  token: string,
  name: string = CONNECT_SHORTCUT_NAME,
): string {
  const query = [
    `name=${encodeURIComponent(name)}`,
    "input=text",
    `text=${encodeURIComponent(token)}`,
  ].join("&");
  return `shortcuts://run-shortcut?${query}`;
}
