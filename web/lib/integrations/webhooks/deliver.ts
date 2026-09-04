import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildWebhookHeaders,
  isSafeWebhookUrl,
} from "../destinations/webhook.ts";
import { nextAttemptState } from "../sync-engine.ts";

// Deliver one claimed webhook_deliveries row: rebuild the exact envelope
// from the stored payload, sign it (HMAC-SHA256 over `${ts}.${body}` with
// the subscription's whsec_ secret), POST it with no redirects and a hard
// timeout, and record the outcome. Real failures go through the shared
// retry policy; after enough terminal failures the subscription flips to
// `failing` and its owner is notified.

const REQUEST_TIMEOUT_MS = 15_000;
const FAILING_THRESHOLD = 3; // terminal failures in the last hour

type DeliveryRow = {
  id: string;
  subscription_id: string;
  workspace_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt: number;
  created_at: string;
};

export async function deliverWebhook(
  admin: SupabaseClient,
  row: DeliveryRow,
): Promise<{ ok: boolean; status: "delivered" | "queued" | "failed" }> {
  const { data: sub } = await admin
    .from("webhook_subscriptions")
    .select("id, url, status")
    .eq("id", row.subscription_id)
    .maybeSingle();
  if (!sub || sub.status === "paused") {
    await terminal(admin, row, "subscription_inactive", null);
    return { ok: false, status: "failed" };
  }

  const safe = isSafeWebhookUrl(sub.url as string);
  if (!safe.ok) {
    await terminal(admin, row, "unsafe_url", null);
    return { ok: false, status: "failed" };
  }

  const { data: secretRow } = await admin
    .from("webhook_subscription_secrets")
    .select("secret")
    .eq("subscription_id", row.subscription_id)
    .maybeSingle();
  if (!secretRow?.secret) {
    await terminal(admin, row, "no_secret", null);
    return { ok: false, status: "failed" };
  }

  const envelope = {
    id: row.id,
    type: row.event_type,
    created_at: row.created_at,
    workspace_id: row.workspace_id,
    data: row.payload ?? {},
  };
  const body = JSON.stringify(envelope);
  const headers = await buildWebhookHeaders(secretRow.secret as string, body);

  let responseStatus: number | null = null;
  let code = "delivery_failed";
  try {
    const res = await fetch(safe.url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    responseStatus = res.status;
    if (res.ok) {
      await admin
        .from("webhook_deliveries")
        .update({
          status: "delivered",
          response_status: res.status,
          delivered_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", row.id);
      return { ok: true, status: "delivered" };
    }
    code = res.status >= 500 ? "http_5xx" : "http_4xx";
  } catch (err) {
    code = (err as { name?: string })?.name === "TimeoutError"
      ? "timeout"
      : "network_error";
  }

  const state = nextAttemptState(row.attempt, code, Date.now());
  if (state.status === "queued") {
    await admin
      .from("webhook_deliveries")
      .update({
        status: "pending",
        attempt: state.attempt,
        next_attempt_at: state.nextAttemptAtMs
          ? new Date(state.nextAttemptAtMs).toISOString()
          : null,
        response_status: responseStatus,
        error: { code },
        claim_token: null,
        claimed_at: null,
      })
      .eq("id", row.id);
    return { ok: false, status: "queued" };
  }

  await terminal(admin, row, code, responseStatus);
  return { ok: false, status: "failed" };
}

async function terminal(
  admin: SupabaseClient,
  row: DeliveryRow,
  code: string,
  responseStatus: number | null,
): Promise<void> {
  await admin
    .from("webhook_deliveries")
    .update({
      status: "failed",
      error: { code },
      response_status: responseStatus,
      claim_token: null,
      claimed_at: null,
    })
    .eq("id", row.id);

  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("webhook_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("subscription_id", row.subscription_id)
    .eq("status", "failed")
    .gte("created_at", since);
  if ((count ?? 0) < FAILING_THRESHOLD) return;

  const { data: sub } = await admin
    .from("webhook_subscriptions")
    .select("status, created_by")
    .eq("id", row.subscription_id)
    .maybeSingle();
  if (!sub || sub.status === "failing") return;

  await admin
    .from("webhook_subscriptions")
    .update({ status: "failing", last_error_code: code })
    .eq("id", row.subscription_id);
  await admin.from("integration_events").insert({
    workspace_id: row.workspace_id,
    kind: "webhook.delivery_failed",
    severity: "warning",
    ref_type: "webhook_subscription",
    ref_id: row.subscription_id,
    summary: "A webhook endpoint is failing and has been paused for delivery",
    context: { code },
  });
  if (sub.created_by) {
    await admin.from("notifications").insert({
      workspace_id: row.workspace_id,
      user_id: sub.created_by,
      event_key: "integration.webhook_failing",
      channel: "in_app",
      title: "A webhook endpoint is failing",
      body:
        "Deliveries to a webhook endpoint keep failing, so it has been paused. Fix the endpoint and resume it from Developer → Webhooks.",
      resource_type: "webhook_subscription",
      resource_id: row.subscription_id,
    });
  }
}
