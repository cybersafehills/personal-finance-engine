// Where tapping a push notification should land. Pure, so it is testable;
// the payload is the `data` object the push drainer sends (IDs only, see
// supabase/functions/send-push-notifications/lib.ts).

export type PushTarget =
  | { pathname: "/transaction/[id]"; params: { id: string } }
  | { pathname: "/forecast" }
  | { pathname: "/notifications" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A transaction notification opens that transaction, a forecast update opens the forecast; everything else opens
 * the notifications list, which shows the full text. The payload comes from
 * outside the app, so anything unexpected falls back to the list rather
 * than being used to build a route.
 */
export function pushTarget(data: unknown): PushTarget {
  if (typeof data === "object" && data !== null) {
    const { resourceType, resourceId } = data as Record<string, unknown>;
    // "Your forecast has been updated" (insight.forecast_update) carries no id.
    if (resourceType === "forecast") return { pathname: "/forecast" };
    if (
      resourceType === "transaction" &&
      typeof resourceId === "string" &&
      UUID.test(resourceId)
    ) {
      return { pathname: "/transaction/[id]", params: { id: resourceId } };
    }
  }
  return { pathname: "/notifications" };
}

/** Accepts only what the server will: an Expo push token. */
export function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/.test(value)
  );
}
