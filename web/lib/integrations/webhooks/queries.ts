import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveWorkspaceId } from "../../queries";
import { supabaseSession } from "../../supabase-session-server";
import type {
  WebhookDeliverySummary,
  WebhookSubscriptionSummary,
} from "./events.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Session read - webhook_subscriptions is RLS-gated on integration.view. */
export async function listWebhookSubscriptions(): Promise<
  WebhookSubscriptionSummary[]
> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("webhook_subscriptions")
    .select(
      "id, url, secret_prefix, event_types, status, description, last_error_code, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("listWebhookSubscriptions failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    url: r.url,
    secretPrefix: r.secret_prefix ?? null,
    eventTypes: (r.event_types ?? []) as string[],
    status: r.status,
    description: r.description ?? null,
    lastErrorCode: r.last_error_code ?? null,
    createdAt: r.created_at,
  }));
}

/**
 * webhook_deliveries grants nothing to authenticated - this reads with the
 * service-role client, pinned to the workspace. The caller MUST have
 * already confirmed the session holds integration.view for this workspace
 * (the /integrations/developer page does). Same "explicit service-role
 * scoping is the boundary" pattern as the reports PDF route.
 */
export async function getRecentWebhookDeliveries(
  admin: SupabaseClient,
  workspaceId: string,
  limit = 20,
): Promise<WebhookDeliverySummary[]> {
  const { data, error } = await admin
    .from("webhook_deliveries")
    .select(
      "id, subscription_id, event_type, status, attempt, response_status, error, created_at, delivered_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("getRecentWebhookDeliveries failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    subscriptionId: r.subscription_id,
    eventType: r.event_type,
    status: r.status,
    attempt: r.attempt,
    responseStatus: r.response_status ?? null,
    errorCode: (r.error as { code?: string } | null)?.code ?? null,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at ?? null,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
