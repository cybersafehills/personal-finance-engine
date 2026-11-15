import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeDrainRequest } from "../send-notifications/lib.ts";
import {
  buildOutboundPushes,
  chunk,
  EXPO_BATCH_SIZE,
  type ExpoTicket,
  type PendingPush,
  pushConfig,
  summarizePush,
  summarizeTickets,
} from "./lib.ts";

// The push drainer (mobile app PR 7, ADR 0019 section 8). Leases unread
// in_app notifications whose user has a phone registered, sends them through
// the Expo push service, and stamps push_sent_at. Dark unless
// PUSH_NOTIFICATIONS_ENABLED === "true" - a missing config is a clean
// no-op, never an error. Authorized by the same scheduler secret as
// send-notifications (NOTIFICATION_CRON_SECRET). Safe to invoke manually;
// anything it fails to send is retried by a later run (bounded in SQL).
//
// Logs counts only: never titles, bodies or push tokens.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const BATCH_LIMIT = 100;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

const EMPTY = { deliveredIds: [], retryIds: [], deadTokens: [] };

Deno.serve(async (request: Request) => {
  const getEnv = (key: string) => Deno.env.get(key) ?? undefined;
  const authorization = authorizeDrainRequest(request, getEnv);
  if (authorization === "method_not_allowed") {
    return json({ ok: false, error: authorization }, 405);
  }
  if (authorization !== "ok") {
    if (authorization === "secret_not_configured") {
      console.error(
        "send-push-notifications: NOTIFICATION_CRON_SECRET is not set",
      );
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const config = pushConfig(getEnv);
  if (!config.enabled) {
    console.log(
      JSON.stringify({ event: "push_drain_skipped", reason: config.reason }),
    );
    return json({
      ok: true,
      ...summarizePush(false, 0, 0, EMPTY, config.reason),
    });
  }

  const claimToken = crypto.randomUUID();
  const { data: rows, error } = await supabase.rpc(
    "claim_notification_pushes",
    { p_claim_token: claimToken, p_limit: BATCH_LIMIT, p_lease_seconds: 300 },
  );
  if (error) {
    console.error("claim_notification_pushes failed:", error.message);
    return json({ ok: false, error: "outbox_read_failed" }, 500);
  }

  const pending = (rows ?? []) as PendingPush[];
  const outbound = buildOutboundPushes(pending);
  if (outbound.length === 0) {
    return json({
      ok: true,
      ...summarizePush(true, pending.length, 0, EMPTY),
    });
  }

  // tickets[i] answers outbound[i]; a failed batch leaves its slots
  // undefined, which summarizeTickets treats as transient.
  const tickets: (ExpoTicket | undefined)[] = new Array(outbound.length);
  let offset = 0;
  for (const batch of chunk(outbound, EXPO_BATCH_SIZE)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          ...(config.accessToken
            ? { "Authorization": `Bearer ${config.accessToken}` }
            : {}),
        },
        body: JSON.stringify(batch.map((push) => push.message)),
      });
      if (res.ok) {
        const payload = await res.json() as { data?: ExpoTicket[] };
        (payload.data ?? []).forEach((ticket, index) => {
          tickets[offset + index] = ticket;
        });
      } else {
        console.error(`expo push batch failed: ${res.status}`);
        await res.body?.cancel();
      }
    } catch (e) {
      console.error(
        "expo push batch threw:",
        e instanceof Error ? e.name : "unknown",
      );
    }
    offset += batch.length;
  }

  const result = summarizeTickets(outbound, tickets);

  if (result.deliveredIds.length > 0) {
    const { error: ackError } = await supabase.rpc(
      "ack_notification_push_claim",
      { p_claim_token: claimToken, p_ids: result.deliveredIds },
    );
    // If the ack fails the lease expires and the row may be pushed again:
    // a duplicate notification, bounded by push_attempts. Preferred over
    // silently losing one.
    if (ackError) {
      console.error("ack_notification_push_claim failed:", ackError.message);
    }
  }
  if (result.retryIds.length > 0) {
    const { error: releaseError } = await supabase.rpc(
      "release_notification_push_claim",
      { p_claim_token: claimToken, p_ids: result.retryIds },
    );
    if (releaseError) {
      console.error(
        "release_notification_push_claim failed:",
        releaseError.message,
      );
    }
  }
  if (result.deadTokens.length > 0) {
    const { error: disableError } = await supabase.rpc(
      "disable_push_devices",
      { p_tokens: result.deadTokens, p_reason: "DeviceNotRegistered" },
    );
    if (disableError) {
      console.error("disable_push_devices failed:", disableError.message);
    }
  }

  const summary = summarizePush(true, pending.length, outbound.length, result);
  console.log(JSON.stringify({ event: "push_drain", ...summary }));
  return json({ ok: true, ...summary });
});
