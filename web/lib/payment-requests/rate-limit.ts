// Fixed-window, in-memory, per-key rate limiter (pure; the clock is injected).
// Best-effort only: state is per server instance and resets on deploy, exactly
// like the existing /verify limiter. The token's 256-bit entropy is the real
// enumeration defence; this exists to blunt scraping/abuse of the public page.
// Unlike a bare Map it caps memory: when `maxKeys` is reached, expired windows
// are purged, and if still full the oldest key is dropped.

export type RateLimiter = (key: string) => boolean;

export function createRateLimiter(
  opts: {
    limit: number;
    windowMs: number;
    maxKeys?: number;
    now?: () => number;
  },
): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (key: string): boolean => {
    const t = now();
    const rec = hits.get(key);
    if (rec && t <= rec.resetAt) {
      rec.count += 1;
      return rec.count > opts.limit;
    }
    if (!rec && hits.size >= maxKeys) {
      for (const [k, v] of hits) if (t > v.resetAt) hits.delete(k);
      if (hits.size >= maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
    }
    hits.delete(key); // re-insert so Map order tracks recency of window start
    hits.set(key, { count: 1, resetAt: t + opts.windowMs });
    return false;
  };
}

/** First hop of x-forwarded-for, or "unknown". */
export function clientIp(xForwardedFor: string | null | undefined): string {
  return (xForwardedFor ?? "").split(",")[0].trim() || "unknown";
}
