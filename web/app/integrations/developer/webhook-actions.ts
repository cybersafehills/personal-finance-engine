"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { generateWebhookSecret } from "../../../lib/credentials";
import { isDeveloperWebhooksEnabled } from "../../../lib/integrations/gate";
import { isSafeWebhookUrl } from "../../../lib/integrations/destinations/webhook";
import { normalizeEventTypes } from "../../../lib/integrations/webhooks/events";
import { enqueuePing } from "../../../lib/integrations/webhooks/dispatch";

type AccessOk = { ok: true; workspaceId: string; userId: string };
type AccessErr = { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

async function requireWebhookAccess(): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isDeveloperWebhooksEnabled(workspaceId)) {
    return { ok: false, error: "Webhooks aren’t enabled for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.developer_manage",
  });
  if (error || allowed !== true) {
    return { ok: false, error: "You don’t have permission to manage webhooks." };
  }
  return { ok: true, workspaceId, userId: user.id };
}

export type CreateWebhookResult =
  | { ok: true; subscriptionId: string; secret: string }
  | { ok: false; error: string };

export async function createWebhook(input: {
  url: string;
  eventTypes: unknown;
  description?: string;
}): Promise<CreateWebhookResult> {
  const access = await requireWebhookAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const safe = isSafeWebhookUrl(input.url ?? "");
  if (!safe.ok) return { ok: false, error: `Webhook URL: ${safe.reason}.` };
  const eventTypes = normalizeEventTypes(input.eventTypes);
  if (eventTypes.length === 0) {
    return { ok: false, error: "Pick at least one event type." };
  }
  const description = (input.description ?? "").trim().slice(0, 200) || null;

  const { secret, prefix } = await generateWebhookSecret();
  const admin = supabaseServer();
  const { data: sub, error } = await admin
    .from("webhook_subscriptions")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      url: safe.url,
      secret_prefix: prefix,
      event_types: eventTypes,
      description,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !sub) {
    console.error("createWebhook insert failed:", error?.message);
    return { ok: false, error: "Could not create the webhook." };
  }
  const { error: secretError } = await admin
    .from("webhook_subscription_secrets")
    .insert({ subscription_id: sub.id, secret });
  if (secretError) {
    await admin.from("webhook_subscriptions").delete().eq("id", sub.id);
    return { ok: false, error: "Could not store the signing secret." };
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "webhook.created",
    severity: "info",
    ref_type: "webhook_subscription",
    ref_id: sub.id,
    summary: `Webhook created (${eventTypes.join(", ")})`,
    context: { actorUserId: userId, eventTypes },
  });

  revalidatePath("/integrations/developer");
  return { ok: true, subscriptionId: sub.id, secret };
}

export async function updateWebhook(
  subscriptionId: string,
  input: { eventTypes?: unknown; status?: "active" | "paused" },
): Promise<SimpleResult> {
  const access = await requireWebhookAccess();
  if (!access.ok) return access;
  const patch: Record<string, unknown> = {};
  if (input.eventTypes !== undefined) {
    const eventTypes = normalizeEventTypes(input.eventTypes);
    if (eventTypes.length === 0) {
      return { ok: false, error: "Pick at least one event type." };
    }
    patch.event_types = eventTypes;
  }
  if (input.status === "active" || input.status === "paused") {
    patch.status = input.status;
    if (input.status === "active") patch.last_error_code = null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const admin = supabaseServer();
  const { error } = await admin
    .from("webhook_subscriptions")
    .update(patch)
    .eq("id", subscriptionId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not update the webhook." };
  revalidatePath("/integrations/developer");
  return { ok: true };
}

export type RotateWebhookResult =
  | { ok: true; secret: string }
  | { ok: false; error: string };

export async function rotateWebhookSecret(
  subscriptionId: string,
): Promise<RotateWebhookResult> {
  const access = await requireWebhookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { data: sub } = await admin
    .from("webhook_subscriptions")
    .select("id")
    .eq("id", subscriptionId)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "That webhook could not be found." };

  const { secret, prefix } = await generateWebhookSecret();
  const { error: sErr } = await admin
    .from("webhook_subscription_secrets")
    .upsert({
      subscription_id: subscriptionId,
      secret,
      rotated_at: new Date().toISOString(),
    });
  if (sErr) return { ok: false, error: "Could not rotate the secret." };
  await admin
    .from("webhook_subscriptions")
    .update({ secret_prefix: prefix })
    .eq("id", subscriptionId);
  revalidatePath("/integrations/developer");
  return { ok: true, secret };
}

export async function deleteWebhook(
  subscriptionId: string,
): Promise<SimpleResult> {
  const access = await requireWebhookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { error } = await admin
    .from("webhook_subscriptions")
    .delete()
    .eq("id", subscriptionId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not delete the webhook." };
  revalidatePath("/integrations/developer");
  return { ok: true };
}

export async function sendWebhookPing(
  subscriptionId: string,
): Promise<SimpleResult> {
  const access = await requireWebhookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { data: sub } = await admin
    .from("webhook_subscriptions")
    .select("id")
    .eq("id", subscriptionId)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "That webhook could not be found." };
  const result = await enqueuePing(admin, {
    id: subscriptionId,
    workspaceId: access.workspaceId,
  });
  if (!result.ok) return { ok: false, error: "Could not queue the test event." };
  revalidatePath("/integrations/developer");
  return { ok: true };
}
