import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWebhookHeaders, isSafeWebhookUrl } from "./webhook.ts";
import {
  isCloudStorageProviderKey,
  type OAuthTokenSet,
} from "./cloud-storage/contract.ts";
import { getCloudStorageClient } from "./cloud-storage/registry.ts";

const EXPORT_BUCKET = "integration-exports";
const SIGNED_URL_TTL = 3600;

export type DeliverExportInput = {
  workspaceId: string;
  exportJobId: string;
  destinationId: string;
  storagePath: string;
  filename: string;
  rowCount: number;
  periodLabel: string;
  trigger: "manual" | "scheduled" | "poll";
};

/**
 * Deliver a finished export file to its destination and record an
 * integration_sync_run. `download` is a no-op (the user pulls it from
 * history); `webhook` POSTs a signed JSON envelope with a short-lived
 * signed download URL; `cloud_storage` / `connected_workbook` are not
 * wired until P2-PR3 / P2-PR4 and record a `partial` run.
 */
export async function deliverExportToDestination(
  admin: SupabaseClient,
  input: DeliverExportInput,
): Promise<{ ok: boolean; error?: string }> {
  const { data: destination } = await admin
    .from("integration_destinations")
    .select("id, kind, config, status")
    .eq("id", input.destinationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (!destination || destination.status === "disabled") {
    return { ok: false, error: "destination unavailable" };
  }
  if (destination.kind === "download") {
    return { ok: true };
  }

  const { data: run } = await admin
    .from("integration_sync_runs")
    .insert({
      workspace_id: input.workspaceId,
      destination_id: input.destinationId,
      export_job_id: input.exportJobId,
      trigger: input.trigger,
      direction: "export",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const finish = async (
    status: "succeeded" | "partial" | "failed",
    error: Record<string, unknown> | null,
    delivered: number,
  ) => {
    if (run) {
      await admin
        .from("integration_sync_runs")
        .update({
          status,
          finished_at: new Date().toISOString(),
          counts: { delivered },
          error,
        })
        .eq("id", run.id);
    }
    await admin
      .from("integration_destinations")
      .update({
        last_delivery_at: new Date().toISOString(),
        status: status === "succeeded" ? "active" : "error",
        last_error_code: status === "succeeded"
          ? null
          : (error?.code as string) ?? "delivery_failed",
      })
      .eq("id", input.destinationId);
  };

  if (destination.kind === "cloud_storage") {
    return deliverToCloudStorage(admin, destination, input, finish);
  }
  if (destination.kind !== "webhook") {
    await finish("partial", { code: "not_wired" }, 0);
    return { ok: false, error: "that destination type is not wired yet" };
  }

  const safe = isSafeWebhookUrl((destination.config as { url?: string })?.url ?? "");
  if (!safe.ok) {
    await finish("failed", { code: "unsafe_url", message: safe.reason }, 0);
    return { ok: false, error: safe.reason };
  }

  const { data: secretRow } = await admin
    .from("integration_destination_secrets")
    .select("secret_material")
    .eq("destination_id", input.destinationId)
    .maybeSingle();
  if (!secretRow) {
    await finish("failed", { code: "no_secret" }, 0);
    return { ok: false, error: "no signing secret" };
  }

  const { data: signed } = await admin.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(input.storagePath, SIGNED_URL_TTL);

  const payload = JSON.stringify({
    type: "oneledger.export.ready",
    export_job_id: input.exportJobId,
    filename: input.filename,
    row_count: input.rowCount,
    period: input.periodLabel,
    download_url: signed?.signedUrl ?? null,
    download_url_expires_in: SIGNED_URL_TTL,
    generated_at: new Date().toISOString(),
  });
  const headers = await buildWebhookHeaders(secretRow.secret_material, payload);

  try {
    const res = await fetch(safe.url, {
      method: "POST",
      headers,
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 200 && res.status < 300) {
      await finish("succeeded", null, 1);
      return { ok: true };
    }
    await finish("failed", { code: "http_error", httpStatus: res.status }, 0);
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : "failed";
    await finish("failed", { code: "network_error", message }, 0);
    return { ok: false, error: message };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function deliverToCloudStorage(
  admin: SupabaseClient,
  destination: any,
  input: DeliverExportInput,
  finish: (
    status: "succeeded" | "partial" | "failed",
    error: Record<string, unknown> | null,
    delivered: number,
  ) => Promise<void>,
): Promise<{ ok: boolean; error?: string }> {
  const providerKey = destination.provider as string;
  if (!isCloudStorageProviderKey(providerKey)) {
    await finish("failed", { code: "unknown_provider" }, 0);
    return { ok: false, error: "unknown provider" };
  }

  const { data: secretRow } = await admin
    .from("integration_destination_secrets")
    .select("secret_material, secret_kind")
    .eq("destination_id", input.destinationId)
    .maybeSingle();
  if (!secretRow || secretRow.secret_kind !== "oauth_token") {
    await finish("partial", { code: "needs_auth" }, 0);
    return { ok: false, error: "destination needs authorisation" };
  }

  let token: OAuthTokenSet;
  try {
    token = JSON.parse(secretRow.secret_material) as OAuthTokenSet;
  } catch {
    await finish("failed", { code: "bad_token" }, 0);
    return { ok: false, error: "stored token is unreadable" };
  }

  const folderPath =
    (destination.config as { folder_path?: string })?.folder_path ?? "/";

  try {
    const client = getCloudStorageClient(providerKey);
    const { data: signed } = await admin.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(input.storagePath, SIGNED_URL_TTL);
    const fileRes = signed?.signedUrl
      ? await fetch(signed.signedUrl, { signal: AbortSignal.timeout(15_000) })
      : null;
    const bytes = fileRes && fileRes.ok
      ? new Uint8Array(await fileRes.arrayBuffer())
      : new Uint8Array();
    await client.uploadFile(token, {
      folderPath,
      filename: input.filename,
      contentType: "application/octet-stream",
      body: bytes,
    });
    await finish("succeeded", null, 1);
    return { ok: true };
  } catch (err) {
    const errCode = (err as { code?: string })?.code;
    const errMsg = err instanceof Error ? err.message : "";
    const code = errCode === "provider_not_configured"
      ? "provider_not_configured"
      : errMsg === "provider_upload_not_implemented"
      ? "provider_upload_not_implemented"
      : "cloud_delivery_failed";
    // "not configured" / "not implemented" are the honest dark-mode states:
    // a partial run, not a hard failure.
    const status = code === "cloud_delivery_failed" ? "failed" : "partial";
    await finish(status, { code }, 0);
    return { ok: false, error: code };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
