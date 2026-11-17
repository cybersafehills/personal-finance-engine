// What the small "Live" indicator says. PURE (no imports) so it is unit-tested.
//
// Three honest states, never a fake "Live":
//  - connecting: nothing shown yet (no flicker on every page load)
//  - live:       the realtime channel is subscribed
//  - offline:    the channel dropped; the app is polling every 15s instead
// A change arriving flashes "Updated" for a moment, only while live.

export type LiveConnection = "connecting" | "live" | "offline";

export type LivePill = {
  text: string;
  tone: "live" | "updated" | "offline";
} | null;

export function describeLive(
  connection: LiveConnection,
  justUpdated: boolean,
): LivePill {
  if (connection === "connecting") return null;
  if (connection === "offline") {
    return { text: "Reconnecting…", tone: "offline" };
  }
  return justUpdated
    ? { text: "Updated", tone: "updated" }
    : { text: "Live", tone: "live" };
}

/** Realtime channel status -> connection. Anything unknown keeps the current state. */
export function connectionFromChannelStatus(
  status: string,
  current: LiveConnection,
): LiveConnection {
  if (status === "SUBSCRIBED") return "live";
  if (
    status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
  ) return "offline";
  return current;
}
