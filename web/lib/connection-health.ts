// Plain-language health of a phone connection, derived only from what the app
// can actually observe (status + last_used_at). Pure so it is deno-testable and
// so the "now" is passed in by the server (never read during client render).

export type ConnectionHealthState =
  | "removed"
  | "paused"
  | "waiting"
  | "working"
  | "quiet";

export type ConnectionHealth = {
  state: ConnectionHealthState;
  /** Whole days since the last message; only set for `quiet`. */
  quietDays: number | null;
};

/** No message for this long on an active connection ⇒ suggest reconnecting. */
export const QUIET_AFTER_HOURS = 48;

const HOUR_MS = 3_600_000;

export function connectionHealth(
  connection: {
    status: "active" | "paused" | "revoked";
    last_used_at: string | null;
  },
  nowMs: number,
): ConnectionHealth {
  if (connection.status === "revoked") {
    return { state: "removed", quietDays: null };
  }
  if (connection.status === "paused") {
    return { state: "paused", quietDays: null };
  }
  if (!connection.last_used_at) return { state: "waiting", quietDays: null };

  const last = Date.parse(connection.last_used_at);
  if (Number.isNaN(last)) return { state: "waiting", quietDays: null };

  const hours = (nowMs - last) / HOUR_MS;
  if (hours >= QUIET_AFTER_HOURS) {
    return { state: "quiet", quietDays: Math.floor(hours / 24) };
  }
  return { state: "working", quietDays: null };
}

/** Server-side convenience: health as of right now (kept out of render code). */
export function connectionHealthNow(connection: {
  status: "active" | "paused" | "revoked";
  last_used_at: string | null;
}): ConnectionHealth {
  return connectionHealth(connection, Date.now());
}
