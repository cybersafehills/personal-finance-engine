"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { hashToken } from "../../../lib/credentials";
import { isDestinationsEnabled } from "../../../lib/integrations/gate";
import {
  buildWebhookHeaders,
  isSafeWebhookUrl,
} from "../../../lib/integrations/destinations/webhook";

type AccessOk = { ok: true; workspaceId: string; userId: string };
type AccessErr = { ok: false; error: string };

async function requireDestinationAccess(): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isDestinationsEnabled(workspaceId)) {
    return { ok: false, error: "Destinations aren’t available for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.destination_manage",
  });
  if (error || allowed !== true) {
    return { ok: false, error: "You don’t have permission to manage destinations." };
  }
  return { ok: true, workspaceId, userId: user.id };
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function newWebhookSecret(): Promise<{ secret: string; hash: string; prefix: string }> {
  const secret = "whsec_" + base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { secret, hash: await hashToken(secret), prefix: secret.slice(0, 12) };
}

export type CreateDestinationResult =
  | { ok: true; destinationId: string; secret?: string }
  | { ok: false; error: string };

/** Create a `download` or `webhook` destination. Webhook returns its
 *  signing secret exactly once. */
export async function createDestination(input: {
  name: string;
  kind: "download" | "webhook";
  url?: string;
}): Promise<CreateDestinationResult> {
  const access = await requireDestinationAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const name = (input.name ?? "").trim();
  if (!name || name.length > 80) {
    return { ok: false, error: "Give the destination a short name." };
  }
  if (input.kind !== "download" && input.kind !== "webhook") {
    return { ok: false, error: "Only download and webhook destinations can be added here." };
  }

  let config: Record<string, unknown> = {};
  if (input.kind === "webhook") {
    const safe = isSafeWebhookUrl(input.url ?? "");
    if (!safe.ok) return { ok: false, error: `Webhook URL: ${safe.reason}.` };
    config = { url: safe.url };
  }

  const admin = supabaseServer();
  const { data: destination, error } = await admin
    .from("integration_destinations")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name,
      kind: input.kind,
      config,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !destination) {
    console.error("createDestination failed", error?.message);
    return { ok: false, error: "Could not create the destination." };
  }

  let revealed: string | undefined;
  if (input.kind === "webhook") {
    const secret = await newWebhookSecret();
    const { error: secretError } = await admin
      .from("integration_destination_secrets")
      .insert({
        destination_id: destination.id,
        secret_kind: "webhook_hmac",
        secret_material: secret.hash,
        secret_prefix: secret.prefix,
      });
    if (secretError) {
      await admin.from("integration_destinations").delete().eq("id", destination.id);
      console.error("createDestination secret failed", secretError.message);
      return { ok: false, error: "Could not store the signing secret." };
    }
    revealed = secret.secret;
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "destination.created",
    severity: "info",
    ref_type: "integration_destination",
    ref_id: destination.id,
    summary: `Destination "${name}" (${input.kind}) added`,
    context: { actorUserId: userId, kind: input.kind },
  });

  revalidatePath("/integrations/sync");
  return { ok: true, destinationId: destination.id, secret: revealed };
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

export async function updateDestination(
  destinationId: string,
  patch: { name?: string; url?: string; status?: "active" | "disabled" },
): Promise<SimpleResult> {
  const access = await requireDestinationAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();

  const { data: existing } = await admin
    .from("integration_destinations")
    .select("kind, config")
    .eq("id", destinationId)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That destination could not be found." };

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) return { ok: false, error: "Invalid name." };
    update.name = name;
  }
  if (patch.status) update.status = patch.status;
  if (patch.url !== undefined && existing.kind === "webhook") {
    const safe = isSafeWebhookUrl(patch.url);
    if (!safe.ok) return { ok: false, error: `Webhook URL: ${safe.reason}.` };
    update.config = { ...(existing.config as object), url: safe.url };
  }

  const { error } = await admin
    .from("integration_destinations")
    .update(update)
    .eq("id", destinationId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not update the destination." };
  revalidatePath("/integrations/sync");
  return { ok: true };
}

export async function deleteDestination(destinationId: string): Promise<SimpleResult> {
  const access = await requireDestinationAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { error } = await admin
    .from("integration_destinations")
    .delete()
    .eq("id", destinationId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not delete the destination." };
  revalidatePath("/integrations/sync");
  return { ok: true };
}

export type RotateResult =
  | { ok: true; secret: string }
  | { ok: false; error: string };

export async function rotateWebhookSecret(
  destinationId: string,
): Promise<RotateResult> {
  const access = await requireDestinationAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();

  const { data: destination } = await admin
    .from("integration_destinations")
    .select("kind")
    .eq("id", destinationId)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (!destination || destination.kind !== "webhook") {
    return { ok: false, error: "That destination has no signing secret." };
  }

  const secret = await newWebhookSecret();
  const { error } = await admin
    .from("integration_destination_secrets")
    .upsert({
      destination_id: destinationId,
      secret_kind: "webhook_hmac",
      secret_material: secret.hash,
      secret_prefix: secret.prefix,
      rotated_at: new Date().toISOString(),
    });
  if (error) return { ok: false, error: "Could not rotate the secret." };

  await admin.from("integration_events").insert({
    workspace_id: access.workspaceId,
    kind: "destination.secret_rotated",
    severity: "info",
    ref_type: "integration_destination",
    ref_id: destinationId,
    summary: "Webhook signing secret rotated",
    context: { actorUserId: access.userId },
  });
  revalidatePath("/integrations/sync");
  return { ok: true, secret: secret.secret };
}

export type TestResult =
  | { ok: true; httpStatus: number }
  | { ok: false; error: string };

/** Send a signed `oneledger.test` payload and record the sync run. */
export async function testDestination(destinationId: string): Promise<TestResult> {
  const access = await requireDestinationAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();

  const { data: destination } = await admin
    .from("integration_destinations")
    .select("id, kind, config")
    .eq("id", destinationId)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (!destination) return { ok: false, error: "That destination could not be found." };
  if (destination.kind !== "webhook") {
    return { ok: false, error: "Only webhook destinations can be tested." };
  }

  const url = (destination.config as { url?: string })?.url ?? "";
  const safe = isSafeWebhookUrl(url);
  if (!safe.ok) return { ok: false, error: `Webhook URL: ${safe.reason}.` };

  const { data: secretRow } = await admin
    .from("integration_destination_secrets")
    .select("secret_material")
    .eq("destination_id", destinationId)
    .maybeSingle();
  if (!secretRow) return { ok: false, error: "No signing secret is set." };

  const body = JSON.stringify({
    type: "oneledger.test",
    destination_id: destinationId,
    sent_at: new Date().toISOString(),
  });
  // Note: the stored material is the SHA-256 of the reveal-once secret;
  // receivers verify against the secret they were given. The test just
  // proves reachability + that we sign with a stable key.
  const headers = await buildWebhookHeaders(secretRow.secret_material, body);

  const { data: run } = await admin
    .from("integration_sync_runs")
    .insert({
      workspace_id: access.workspaceId,
      destination_id: destinationId,
      trigger: "manual",
      direction: "export",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  let httpStatus = 0;
  let deliveryError: string | null = null;
  try {
    const res = await fetch(safe.url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = res.status;
  } catch (err) {
    deliveryError = err instanceof Error ? err.message.slice(0, 200) : "failed";
  }

  const succeeded = deliveryError === null && httpStatus >= 200 && httpStatus < 300;
  if (run) {
    await admin
      .from("integration_sync_runs")
      .update({
        status: succeeded ? "succeeded" : "failed",
        finished_at: new Date().toISOString(),
        counts: { delivered: succeeded ? 1 : 0 },
        error: succeeded ? null : { httpStatus, message: deliveryError },
      })
      .eq("id", run.id);
  }
  await admin
    .from("integration_destinations")
    .update({
      last_delivery_at: new Date().toISOString(),
      status: succeeded ? "active" : "error",
      last_error_code: succeeded ? null : "test_failed",
    })
    .eq("id", destinationId);

  revalidatePath("/integrations/sync");
  return succeeded
    ? { ok: true, httpStatus }
    : { ok: false, error: deliveryError ?? `Endpoint returned HTTP ${httpStatus}.` };
}
