import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken } from "../../credentials";
import { buildWebhookEnvelope, type WebhookEvent } from "./events.ts";

// Fan-out: when a webhook-worthy event happens, insert one `pending`
// webhook_deliveries row per matching active subscription. The
// deliver-webhooks cron does the actual signed POST. The delivery id IS
// the envelope id, so the row is self-contained and the body is fixed at
// enqueue time (payload + payload_digest stored on the row).
//
// `data` MUST already be redacted by the caller: ids and safe scalar
// fields only. Never pass counterparties, raw financial text, tokens, or
// storage paths.

export async function enqueueWebhookEvent(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    type: WebhookEvent;
    data: Record<string, unknown>;
    eventRef?: string | null;
  },
): Promise<{ enqueued: number }> {
  const { data: subs, error } = await admin
    .from("webhook_subscriptions")
    .select("id, event_types")
    .eq("workspace_id", params.workspaceId)
    .eq("status", "active")
    .contains("event_types", [params.type]);
  if (error) {
    console.error("enqueueWebhookEvent: subscription query failed", error.message);
    return { enqueued: 0 };
  }
  const matching = (subs ?? []) as { id: string; event_types: string[] }[];
  if (matching.length === 0) return { enqueued: 0 };

  const now = new Date();
  const rows: Record<string, unknown>[] = [];
  for (const sub of matching) {
    const deliveryId = crypto.randomUUID();
    const envelope = buildWebhookEnvelope({
      deliveryId,
      type: params.type,
      workspaceId: params.workspaceId,
      data: params.data,
      now,
    });
    const body = JSON.stringify(envelope);
    rows.push({
      id: deliveryId,
      subscription_id: sub.id,
      workspace_id: params.workspaceId,
      event_type: params.type,
      event_ref: params.eventRef ?? null,
      payload: envelope.data,
      payload_digest: await hashToken(body),
      status: "pending",
      attempt: 0,
      next_attempt_at: now.toISOString(),
      created_at: now.toISOString(),
    });
  }

  const { error: insertError } = await admin
    .from("webhook_deliveries")
    .insert(rows);
  if (insertError) {
    console.error("enqueueWebhookEvent: delivery insert failed", insertError.message);
    return { enqueued: 0 };
  }
  return { enqueued: rows.length };
}

/**
 * Best-effort wrapper: never let a webhook fan-out failure break the
 * caller's own transaction. Fire-and-forget from an emit site.
 */
export function fireWebhookEvent(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    type: WebhookEvent;
    data: Record<string, unknown>;
    eventRef?: string | null;
  },
): void {
  void enqueueWebhookEvent(admin, params).catch((err) => {
    console.error("fireWebhookEvent failed", err);
  });
}
