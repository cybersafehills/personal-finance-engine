// Pure app-lock policy, kept separate from React and native APIs so the
// rules are unit-testable.

/** Time in the background after which the app locks again. */
export const RELOCK_AFTER_MS = 60_000;

/** Lock on a cold start whenever the lock is turned on. */
export function shouldLockOnLaunch(enabled: boolean): boolean {
  return enabled;
}

/**
 * Lock when returning to the foreground after at least RELOCK_AFTER_MS away.
 * `backgroundedAtMs` is null when the app never left the foreground.
 */
export function shouldLockOnResume(
  enabled: boolean,
  backgroundedAtMs: number | null,
  nowMs: number,
): boolean {
  if (!enabled || backgroundedAtMs === null) return false;
  return nowMs - backgroundedAtMs >= RELOCK_AFTER_MS;
}
