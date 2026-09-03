"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { hashToken } from "../../../lib/credentials";
import {
  isCloudStorageEnabled,
  isDestinationsEnabled,
  isWorkbooksEnabled,
} from "../../../lib/integrations/gate";
import {
  isRealWorkbookProvider,
  normalizeSheetMap,
  WORKBOOK_PROVIDERS,
  type WorkbookProvider,
} from "../../../lib/integrations/workbooks/contract";
import { runWorkbookSync } from "../../../lib/integrations/workbooks/sync";
import {
  buildWebhookHeaders,
  isSafeWebhookUrl,
} from "../../../lib/integrations/destinations/webhook";
import {
  isCloudStorageProviderKey,
  normalizeFolderPath,
} from "../../../lib/integrations/destinations/cloud-storage/contract";
import { isCloudProviderConfigured } from "../../../lib/integrations/destinations/cloud-storage/registry";

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

// --- cloud-storage destinations (dark until a provider is configured) ------

export type CreateCloudDestinationResult =
  | { ok: true; destinationId: string; connectUrl: string | null }
  | { ok: false; error: string };

/** Create a cloud-storage destination. It starts `needs_auth`; the caller
 *  then sends the user to connectUrl (the OAuth start route) - which
 *  itself returns 501 while the provider is dark. */
export async function createCloudStorageDestination(input: {
  name: string;
  provider: string;
  folderPath: string;
}): Promise<CreateCloudDestinationResult> {
  const access = await requireDestinationAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  if (!isCloudStorageEnabled(workspaceId)) {
    return { ok: false, error: "Cloud-storage destinations aren’t enabled." };
  }
  const name = (input.name ?? "").trim();
  if (!name || name.length > 80) {
    return { ok: false, error: "Give the destination a short name." };
  }
  if (!isCloudStorageProviderKey(input.provider)) {
    return { ok: false, error: "Unknown cloud provider." };
  }
  const folder = normalizeFolderPath(input.folderPath);
  if (folder === null) return { ok: false, error: "That folder path isn’t valid." };

  const admin = supabaseServer();
  const { data: destination, error } = await admin
    .from("integration_destinations")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name,
      kind: "cloud_storage",
      provider: input.provider,
      config: { folder_path: folder },
      status: "needs_auth",
    })
    .select("id")
    .single();
  if (error || !destination) {
    console.error("createCloudStorageDestination failed", error?.message);
    return { ok: false, error: "Could not create the destination." };
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "destination.created",
    severity: "info",
    ref_type: "integration_destination",
    ref_id: destination.id,
    summary: `Destination "${name}" (${input.provider}) added — needs authorisation`,
    context: { actorUserId: userId, kind: "cloud_storage", provider: input.provider },
  });

  revalidatePath("/integrations/sync");
  return {
    ok: true,
    destinationId: destination.id,
    connectUrl: isCloudProviderConfigured(input.provider)
      ? `/api/integrations/oauth/${input.provider}/start?destination_id=${destination.id}`
      : null,
  };
}

// --- connected workbooks (INTEGRATIONS_WORKBOOKS_ENABLED, integration.workbook_manage) ---

async function requireWorkbookAccess(): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isWorkbooksEnabled(workspaceId)) {
    return { ok: false, error: "Connected workbooks aren’t enabled for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.workbook_manage",
  });
  if (error || allowed !== true) {
    return { ok: false, error: "You don’t have permission to manage workbooks." };
  }
  return { ok: true, workspaceId, userId: user.id };
}

export type ConnectWorkbookResult =
  | { ok: true; workbookId: string; needsAuth: boolean }
  | { ok: false; error: string };

export async function connectWorkbook(input: {
  name: string;
  provider: string;
  direction: "export" | "import" | "two_way";
  sheetMap?: unknown;
}): Promise<ConnectWorkbookResult> {
  const access = await requireWorkbookAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const name = (input.name ?? "").trim();
  if (!name || name.length > 80) {
    return { ok: false, error: "Give the workbook a short name." };
  }
  if (!(WORKBOOK_PROVIDERS as readonly string[]).includes(input.provider)) {
    return { ok: false, error: "Unknown workbook provider." };
  }
  const provider = input.provider as WorkbookProvider;
  if (!["export", "import", "two_way"].includes(input.direction)) {
    return { ok: false, error: "Choose a sync direction." };
  }

  const admin = supabaseServer();
  const { data: destination, error: destError } = await admin
    .from("integration_destinations")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name,
      kind: "connected_workbook",
      provider,
      config: {},
      status: isRealWorkbookProvider(provider) ? "active" : "needs_auth",
    })
    .select("id")
    .single();
  if (destError || !destination) {
    console.error("connectWorkbook destination failed", destError?.message);
    return { ok: false, error: "Could not create the workbook link." };
  }

  const { data: workbook, error: wbError } = await admin
    .from("connected_workbooks")
    .insert({
      workspace_id: workspaceId,
      destination_id: destination.id,
      sheet_map: normalizeSheetMap(input.sheetMap),
      direction: input.direction,
      source_of_truth: "oneledger",
      status: isRealWorkbookProvider(provider) ? "active" : "needs_auth",
      created_by: userId,
    })
    .select("id")
    .single();
  if (wbError || !workbook) {
    await admin.from("integration_destinations").delete().eq("id", destination.id);
    console.error("connectWorkbook workbook failed", wbError?.message);
    return { ok: false, error: "Could not create the workbook." };
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "workbook.connected",
    severity: "info",
    ref_type: "connected_workbook",
    ref_id: workbook.id,
    summary: `Workbook "${name}" (${provider}) connected`,
    context: { actorUserId: userId, provider, direction: input.direction },
  });

  revalidatePath("/integrations/sync");
  return {
    ok: true,
    workbookId: workbook.id,
    needsAuth: !isRealWorkbookProvider(provider),
  };
}

export async function syncWorkbookNow(
  workbookId: string,
): Promise<SimpleResult> {
  const access = await requireWorkbookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const result = await runWorkbookSync(admin, {
    workbookId,
    workspaceId: access.workspaceId,
    trigger: "manual",
  });
  revalidatePath("/integrations/sync");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function setWorkbookStatus(
  workbookId: string,
  status: "active" | "paused",
): Promise<SimpleResult> {
  const access = await requireWorkbookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { error } = await admin
    .from("connected_workbooks")
    .update({ status })
    .eq("id", workbookId)
    .eq("workspace_id", access.workspaceId)
    .not("status", "in", "(disconnected)");
  if (error) return { ok: false, error: "Could not update the workbook." };
  revalidatePath("/integrations/sync");
  return { ok: true };
}

export async function updateWorkbookSheetMap(
  workbookId: string,
  sheetMap: unknown,
): Promise<SimpleResult> {
  const access = await requireWorkbookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { error } = await admin
    .from("connected_workbooks")
    .update({ sheet_map: normalizeSheetMap(sheetMap) })
    .eq("id", workbookId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not save the sheet map." };
  revalidatePath("/integrations/sync");
  return { ok: true };
}

export async function disconnectWorkbook(
  workbookId: string,
): Promise<SimpleResult> {
  const access = await requireWorkbookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { data: workbook } = await admin
    .from("connected_workbooks")
    .select("destination_id")
    .eq("id", workbookId)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (!workbook) return { ok: false, error: "That workbook could not be found." };

  await admin.from("connected_workbooks").delete().eq("id", workbookId);
  await admin
    .from("integration_destinations")
    .delete()
    .eq("id", workbook.destination_id)
    .eq("workspace_id", access.workspaceId);
  revalidatePath("/integrations/sync");
  return { ok: true };
}

// --- workbook file upload (manual_file, inbound) + conflict resolution ------

export async function uploadWorkbookFile(
  workbookId: string,
  formData: FormData,
): Promise<SimpleResult> {
  const access = await requireWorkbookAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();

  const { data: workbook } = await admin
    .from("connected_workbooks")
    .select("id, direction, destination_id")
    .eq("id", workbookId)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();
  if (!workbook) return { ok: false, error: "That workbook could not be found." };
  const { data: destination } = await admin
    .from("integration_destinations")
    .select("provider")
    .eq("id", workbook.destination_id)
    .maybeSingle();
  if (destination?.provider !== "manual_file") {
    return { ok: false, error: "File upload is only for stored-file workbooks." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an .xlsx file." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "Only .xlsx files are supported." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: "That file is larger than the 10 MB limit." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${access.workspaceId}/${workbookId}.xlsx`;
  const { error: uploadError } = await admin.storage
    .from("integration-workbooks")
    .upload(path, bytes, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (uploadError) {
    console.error("uploadWorkbookFile failed", uploadError.message);
    return { ok: false, error: "Could not store the file." };
  }
  await admin
    .from("connected_workbooks")
    .update({ external_ref: path })
    .eq("id", workbookId);

  const result = await runWorkbookSync(admin, {
    workbookId,
    workspaceId: access.workspaceId,
    trigger: "manual",
  });
  revalidatePath("/integrations/sync");
  revalidatePath("/integrations/sync/conflicts");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

async function requireConflictAccess(): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isWorkbooksEnabled(workspaceId)) {
    return { ok: false, error: "Conflict review isn’t enabled for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.conflict_resolve",
  });
  if (error || allowed !== true) {
    return { ok: false, error: "You don’t have permission to resolve conflicts." };
  }
  return { ok: true, workspaceId, userId: user.id };
}

/** Keep-OneLedger / Ignore: a plain status update, no ledger write. */
export async function resolveConflict(
  conflictId: string,
  resolution: "kept_oneledger" | "ignored",
): Promise<SimpleResult> {
  const access = await requireConflictAccess();
  if (!access.ok) return access;
  if (resolution !== "kept_oneledger" && resolution !== "ignored") {
    return { ok: false, error: "Unknown resolution." };
  }
  const admin = supabaseServer();
  const { error } = await admin
    .from("integration_conflicts")
    .update({
      status: resolution,
      resolved_by: access.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", conflictId)
    .eq("workspace_id", access.workspaceId)
    .eq("status", "open");
  if (error) return { ok: false, error: "Could not update the conflict." };
  await admin.from("integration_events").insert({
    workspace_id: access.workspaceId,
    kind: "conflict.resolved",
    severity: "info",
    ref_type: "integration_conflict",
    ref_id: conflictId,
    summary: `Conflict ${resolution === "ignored" ? "ignored" : "kept as OneLedger"}`,
    context: { actorUserId: access.userId, resolution },
  });
  revalidatePath("/integrations/sync/conflicts");
  return { ok: true };
}

/** Accept external: applies one whitelisted field to the ledger via the RPC. */
export async function applyConflict(conflictId: string): Promise<SimpleResult> {
  const access = await requireConflictAccess();
  if (!access.ok) return access;
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("apply_integration_conflict", {
    p_conflict_id: conflictId,
  });
  if (error) {
    console.error("applyConflict failed", error.message);
    return {
      ok: false,
      error: error.message.includes("permission")
        ? "You don’t have permission to resolve conflicts."
        : "That conflict could not be applied.",
    };
  }
  revalidatePath("/integrations/sync/conflicts");
  revalidatePath("/transactions");
  return { ok: true };
}
