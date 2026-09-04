// Pure scope vocabulary + helpers for the developer API (Integrations
// Phase 4, migration 20261121000000). No server-only import - reused by
// the key-management UI and unit-tested.

/** The complete read-only scope set. Mirrors the api_keys.scopes CHECK. */
export const API_SCOPES = [
  "transactions:read",
  "accounts:read",
  "categories:read",
  "exports:read",
  "sync:read",
  "events:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isKnownScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Keep only recognised scopes, deduped, in canonical order. */
export function normalizeScopes(raw: unknown): ApiScope[] {
  const input = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v === "string" && isKnownScope(v)) seen.add(v);
  }
  return API_SCOPES.filter((s) => seen.has(s));
}

/** True when the key's granted scopes include `required`. */
export function hasScope(
  granted: readonly string[],
  required: ApiScope,
): boolean {
  return granted.includes(required);
}

export const API_KEY_PREFIX = "olk_";

/** True for a syntactically plausible bearer token. */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX) && token.length >= 20 &&
    token.length <= 128 && /^[A-Za-z0-9_-]+$/.test(token);
}

/**
 * Extract a bearer token from an Authorization header value, or null.
 * Accepts `Bearer <token>` (case-insensitive scheme) and a bare token.
 */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const m = /^bearer\b\s*(.*)$/i.exec(trimmed);
  const token = (m ? m[1] : trimmed).trim();
  return token.length > 0 ? token : null;
}
