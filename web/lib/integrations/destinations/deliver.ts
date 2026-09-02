import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWebhookHeaders, isSafeWebhookUrl } from "./webhook.ts";

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

  if (destination.kind !== "webhook") {
    await finish("partial", { code: "provider_not_configured" }, 0);
    return { ok: false, error: "provider not configured" };
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
