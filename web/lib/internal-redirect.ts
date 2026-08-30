const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/;

/**
 * Return a same-origin application path, or the supplied safe fallback.
 * URL parsing alone is insufficient here because `//host` and backslashes
 * can be interpreted as cross-origin navigation by browsers/proxies.
 */
export function internalRedirectPath(
  candidate: string | null | undefined,
  fallback = "/",
): string {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    CONTROL_OR_BACKSLASH.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://oneledger.invalid");
    if (parsed.origin !== "https://oneledger.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
