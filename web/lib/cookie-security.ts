/**
 * Whether a first-party cookie should carry the `Secure` attribute.
 *
 * Production is always https, so it always gets `Secure`. The exception is a
 * loopback host (localhost, 127.0.0.1, [::1]) served over plain http - the
 * e2e suite runs a production build on http://127.0.0.1. Chromium treats
 * loopback as a secure context and keeps `Secure` cookies there; WebKit
 * (Safari, every iPhone browser) silently drops them, which broke signup
 * verification and Space switching on the WebKit e2e projects.
 *
 * Pure (no Next.js imports) so it is deno-testable; callers pass the
 * request's Host header.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  // Strip the port: "[::1]:3000" -> "[::1]", "127.0.0.1:3417" -> "127.0.0.1".
  const hostname = value.startsWith("[")
    ? value.slice(0, value.indexOf("]") + 1)
    : value.split(":")[0];
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

export function shouldUseSecureCookie(host: string | null | undefined): boolean {
  return !isLoopbackHost(host);
}
