// Pure helpers for the push drainer (mobile app PR 7, ADR 0019 section 8).
// index.ts wires these to the real Supabase client, the Expo push service
// and Deno.env; the tests wire them to plain values.
//
// Push is a second delivery of in_app notification rows (see migration
// 20261221000000_push_devices.sql). One notification fans out to every
// active phone its user registered.

export type PushConfig =
  | { enabled: true; accessToken: string | null }
  | { enabled: false; reason: string };

/**
 * Dark unless PUSH_NOTIFICATIONS_ENABLED === "true", matching this repo's
 * other opt-in integrations. EXPO_ACCESS_TOKEN is optional: it is only
 * required when the Expo project has "enhanced push security" turned on.
 */
export function pushConfig(
  get: (key: string) => string | undefined,
): PushConfig {
  if (get("PUSH_NOTIFICATIONS_ENABLED") !== "true") {
    return {
      enabled: false,
      reason: "PUSH_NOTIFICATIONS_ENABLED is not 'true'",
    };
  }
  const token = (get("EXPO_ACCESS_TOKEN") ?? "").trim();
  return { enabled: true, accessToken: token || null };
}

/** One row from claim_notification_pushes. */
export type PendingPush = {
  id: string;
  title: string;
  body: string | null;
  event_key: string;
  resource_type: string | null;
  resource_id: string | null;
  tokens: string[];
};

/** The Expo push message shape we send (a subset of the API). */
export type ExpoMessage = {
  to: string;
  title: string;
  body?: string;
  sound: "default";
  channelId: "default";
  /** Read by the app to open the right screen. IDs only, no amounts. */
  data: {
    notificationId: string;
    eventKey: string;
    resourceType: string | null;
    resourceId: string | null;
  };
};

/** A message plus the notification row it belongs to. */
export type OutboundPush = { notificationId: string; message: ExpoMessage };

/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH_SIZE = 100;

/** Flattens claimed rows into one message per (notification, phone). */
export function buildOutboundPushes(rows: PendingPush[]): OutboundPush[] {
  const out: OutboundPush[] = [];
  for (const row of rows) {
    for (const to of new Set(row.tokens ?? [])) {
      const message: ExpoMessage = {
        to,
        title: row.title,
        sound: "default",
        channelId: "default",
        data: {
          notificationId: row.id,
          eventKey: row.event_key,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
        },
      };
      if (row.body && row.body.trim()) message.body = row.body;
      out.push({ notificationId: row.id, message });
    }
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** One entry of the Expo response's `data` array, in request order. */
export type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

export type PushResult = {
  /** Reached at least one phone: the row is done. */
  deliveredIds: string[];
  /** No phone accepted it and at least one failure was transient: retry. */
  retryIds: string[];
  /** Tokens the push service says are permanently dead. */
  deadTokens: string[];
};

/**
 * Folds per-message tickets back into per-notification outcomes.
 *
 * `tickets[i]` answers `sent[i]`. A missing ticket (the request for that
 * batch failed outright) counts as a transient failure. A notification
 * whose every phone is dead is treated as delivered-nowhere-to-go: it is
 * acknowledged, not retried, because retrying cannot succeed and the dead
 * tokens are being disabled.
 */
export function summarizeTickets(
  sent: OutboundPush[],
  tickets: (ExpoTicket | undefined)[],
): PushResult {
  const perRow = new Map<string, { ok: boolean; transient: boolean }>();
  const dead = new Set<string>();

  sent.forEach((push, index) => {
    const state = perRow.get(push.notificationId) ??
      { ok: false, transient: false };
    const ticket = tickets[index];
    if (ticket?.status === "ok") {
      state.ok = true;
    } else if (ticket?.details?.error === "DeviceNotRegistered") {
      dead.add(push.message.to);
    } else {
      state.transient = true;
    }
    perRow.set(push.notificationId, state);
  });

  const deliveredIds: string[] = [];
  const retryIds: string[] = [];
  for (const [id, state] of perRow) {
    if (state.ok || !state.transient) deliveredIds.push(id);
    else retryIds.push(id);
  }
  return { deliveredIds, retryIds, deadTokens: [...dead] };
}

export type PushSummary = {
  enabled: boolean;
  claimed: number;
  messages: number;
  delivered: number;
  retry: number;
  deadTokens: number;
  reason?: string;
};

/** Counts only: never titles, bodies or tokens. */
export function summarizePush(
  enabled: boolean,
  claimed: number,
  messages: number,
  result: PushResult,
  reason?: string,
): PushSummary {
  return {
    enabled,
    claimed,
    messages,
    delivered: result.deliveredIds.length,
    retry: result.retryIds.length,
    deadTokens: result.deadTokens.length,
    ...(reason ? { reason } : {}),
  };
}
