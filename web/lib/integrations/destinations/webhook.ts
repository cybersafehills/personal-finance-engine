// Signing + SSRF guarding for the webhook destination. Pure (Web Crypto,
// no server-only) so the signer and the host guard are unit-tested; the
// actual fetch happens in the delivery cron.

/** HMAC-SHA256 hex of `${timestamp}.${body}`, the value sent as
 *  `X-OneLedger-Signature`. Receivers recompute it with their shared
 *  secret and compare. */
export async function signWebhookPayload(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type WebhookHeaders = {
  "content-type": string;
  "x-oneledger-timestamp": string;
  "x-oneledger-signature": string;
};

export async function buildWebhookHeaders(
  secret: string,
  body: string,
  now: Date = new Date(),
): Promise<WebhookHeaders> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    "content-type": "application/json",
    "x-oneledger-timestamp": timestamp,
    "x-oneledger-signature": await signWebhookPayload(secret, timestamp, body),
  };
}

// --- SSRF guard -----------------------------------------------------------

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^0\./, // 0.0.0.0/8
  /^10\./, // private
  /^127\./, // loopback
  /^169\.254\./, // link-local + cloud metadata (169.254.169.254)
  /^172\.(1[6-9]|2\d|3[01])\./, // private
  /^192\.168\./, // private
  /^::1$/,
  /^fc00:/i, // ULA
  /^fe80:/i, // link-local
];

/**
 * Reject anything that is not a plain https URL to a public host. Literal
 * private / loopback / link-local addresses and obvious internal names are
 * blocked. DNS rebinding is a residual risk — the delivery path must also
 * refuse redirects and may re-check the resolved address.
 */
export function isSafeWebhookUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "must be an https:// URL" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials in the URL are not allowed" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, reason: "that host is not reachable from OneLedger" };
  }
  return { ok: true, url: url.toString() };
}
