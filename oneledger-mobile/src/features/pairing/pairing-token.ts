// Port of the token half of web/lib/pairing.ts. Pure: the caller supplies
// the random bytes and the hash, so this is testable and identical on every
// platform. Must keep producing tokens the server accepts
// (PAIRING_TOKEN_PATTERN, mirrored in supabase/functions/_shared/pairing.ts).

const DISPLAY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648

export const PAIRING_TOKEN_PATTERN = /^olp_[A-Za-z0-9]{4}[A-Za-z0-9_-]{16,}$/;

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
    // Keep only the unconsumed low bits so `value` never overflows 32 bits.
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export type GeneratedPairingToken = {
  /** The one-time secret. Sent to the capture endpoint, never stored. */
  token: string;
  /** `olp_XXXX`: a display fragment that is safe to keep. */
  prefix: string;
};

/**
 * `olp_` + 4 display chars + 26 base32 chars (128 bits of entropy).
 * `randomBytes(n)` must return n cryptographically secure random bytes.
 */
export function generatePairingToken(
  randomBytes: (n: number) => Uint8Array,
): GeneratedPairingToken {
  const display = Array.from(
    randomBytes(4),
    (b) => DISPLAY_ALPHABET[b % DISPLAY_ALPHABET.length],
  ).join("");
  const prefix = `olp_${display}`;
  return { token: `${prefix}${base32(randomBytes(16))}`, prefix };
}

/** Same mapping as web/lib/pairing.ts `connectorKeyForProvider`. */
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

/**
 * Customer copy for a failed `create_device_pairing_session`, matching the
 * web wizard's wording (app/integrations/connections/pair/actions.ts).
 */
export function startPairingErrorMessage(rpcMessage: string): string {
  if (rpcMessage.includes("Only a workspace owner")) {
    return "Only a workspace owner can connect a device.";
  }
  if (rpcMessage.includes("Too many pending")) {
    return "You have a few pairing codes on the go already. Finish or wait for one to expire, then try again.";
  }
  if (rpcMessage.includes("owned by another user")) {
    return "This account is linked to another person's data and can't be paired from here.";
  }
  if (rpcMessage.includes("selected account is unavailable")) {
    return "That account can't be connected. Check that it's active and belongs to this workspace.";
  }
  return "Could not start connecting. Please try again.";
}
