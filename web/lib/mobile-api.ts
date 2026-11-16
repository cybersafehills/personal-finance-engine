// Pure helpers for the mobile API (/api/mobile/*, ADR 0019). Zero imports
// so they are unit-testable with `deno test` (mobile_api_test.ts), like the
// rest of this repo's pure logic.
//
// /api/mobile/* is what the OneLedger mobile app calls for operations the
// web performs in server actions (sign-in lockout, MFA-gated mutations).
// Dark (404) unless MOBILE_API_ENABLED === "true". Env values are passed in
// by the caller (same convention as devicePairingV2Enabled).

export function isMobileApiEnabled(value: string | undefined): boolean {
  return value === "true";
}

/**
 * CORS is only for browser-based development previews of the app (Expo
 * web on localhost). Native apps send no Origin and need no CORS. Returns
 * the origin to echo back, or null. Exact-match allowlist from
 * MOBILE_API_CORS_ORIGINS (comma-separated); never a wildcard.
 */
export function allowedCorsOrigin(
  origin: string | null,
  allowlist: string | undefined,
): string | null {
  if (!origin || !allowlist) return null;
  const allowed = allowlist.split(",").map((o) => o.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

export type SignInBody = { email: string; password: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the sign-in JSON body. Returns null when it is not usable. */
export function parseSignInBody(body: unknown): SignInBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) return null;
  if (password.length < 1 || password.length > 1024) return null;
  return { email: trimmed, password };
}

// Coarse per-IP limiter (per server instance; resets on deploy). The real
// brute-force defences are the per-account lockout in
// lib/auth/password-sign-in.ts and Supabase Auth's own per-IP limit; this
// only stops one client hammering the endpoint.
const HITS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

export function mobileAuthRateLimited(
  ip: string,
  now: number = Date.now(),
  maxPerWindow: number = MAX_PER_WINDOW,
): boolean {
  const rec = HITS.get(ip);
  if (!rec || now > rec.resetAt) {
    HITS.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > maxPerWindow;
}

// ---------------------------------------------------------------------------
// Bearer-authenticated reads (GET /api/mobile/inbox, ...). The app presents
// its Supabase access token; the route validates it with Supabase Auth and
// then runs the ordinary read models under that token, so RLS is still the
// boundary. These helpers are the pure parts.
// ---------------------------------------------------------------------------

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * The `aal` claim of a Supabase access token. Read only AFTER Supabase Auth
 * has validated the token (getUser), so the claim is trustworthy; this never
 * verifies a signature itself.
 */
export function tokenAal(token: string): "aal1" | "aal2" | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { aal?: unknown };
    return claims.aal === "aal1" || claims.aal === "aal2" ? claims.aal : null;
  } catch {
    return null;
  }
}

/**
 * The `iat` (issued-at, unix seconds) claim of an access token. Same caveat as
 * `tokenAal`: read only after Supabase Auth validated the token. Used for the
 * advisory "recent sign-in" signal, matching the web's isSessionFresh (which
 * also measures the current access token's age).
 */
export function tokenIssuedAt(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { iat?: unknown };
    return typeof claims.iat === "number" && Number.isFinite(claims.iat)
      ? claims.iat
      : null;
  } catch {
    return null;
  }
}

/** True when the token was issued within `maxMinutes` of `nowMs`. */
export function tokenIsFresh(
  token: string,
  maxMinutes: number,
  nowMs: number = Date.now(),
): boolean {
  const iat = tokenIssuedAt(token);
  if (iat === null) return false;
  return (nowMs - iat * 1000) / 60000 <= maxMinutes;
}

/**
 * A user who has a verified second factor must have completed it. A session
 * that only passed the password step (aal1) is not enough, so a stolen or
 * half-finished sign-in cannot read the Inbox.
 */
export function mfaSatisfied(
  aal: "aal1" | "aal2" | null,
  factors: ReadonlyArray<{ status?: string }> | undefined | null,
): boolean {
  const hasVerifiedFactor = (factors ?? []).some((f) => f.status === "verified");
  return !hasVerifiedFactor || aal === "aal2";
}

/** CORS for browser development previews only; same exact-match rule as sign-in. */
export function corsHeadersFor(
  origin: string | null,
  allowlist: string | undefined,
  methods: string,
): Record<string, string> {
  const allowed = allowedCorsOrigin(origin, allowlist);
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Vary": "Origin",
  };
}

/**
 * Resolves the signed-in user for a session client. On a bearer (mobile)
 * request the client is built with `persistSession: false` and only an
 * Authorization header, so it has no stored session: a bare
 * `auth.getUser()` answers "Auth session missing" and callers see no user.
 * Passing the already-validated access token to `getUser(token)` asks Auth
 * about that token directly. With no token (the cookie-based web), it is the
 * plain `getUser()` exactly as before.
 */
export function getUserForRequest<R>(
  auth: { getUser: (jwt?: string) => Promise<R> },
  bearer: string | null,
): Promise<R> {
  return bearer ? auth.getUser(bearer) : auth.getUser();
}
