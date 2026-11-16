// The request id sent with "prepare payment". The server dedupes on it, so a
// double tap or a retry returns the same intent. It must change whenever what
// is being asked changes (amount, recipient or paying account): reusing an old
// id for an edited amount would silently return the OLD intent.

/** A v4 UUID. An idempotency key is not a secret, so Math.random is acceptable where crypto is missing. */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Hands back the same id for the same request and a fresh one when the request
 * changes. The fingerprint is whatever identifies "what is being asked".
 */
export function createKeyTracker(make: () => string = newRequestId) {
  let lastFingerprint: string | null = null;
  let lastKey: string | null = null;
  return {
    keyFor(fingerprint: string): string {
      if (lastKey === null || fingerprint !== lastFingerprint) {
        lastKey = make();
        lastFingerprint = fingerprint;
      }
      return lastKey;
    },
  };
}
