import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePeriod } from "../export/period.ts";
import { buildExportDataset } from "../export/query.ts";
import { datasetToSheetRows } from "../export/workbook.ts";
import { normalizeSheetMap, type WorkbookProvider } from "./contract.ts";
import { getWorkbookAdapter } from "./registry.ts";

export type WorkbookSyncResult =
  | { ok: true; syncRunId: string; counts: Record<string, number> }
  | { ok: false; error: string; syncRunId?: string };

/**
 * Run one connected-workbook sync. Export direction pushes the whole
 * ledger into the workbook's mapped sheets (real for manual_file, a
 * `partial` run for the dark providers). Import / two-way inbound
 * handling lands in P2-PR5 and is a no-op here.
 */
export async function runWorkbookSync(
  admin: SupabaseClient,
  input: {
    workbookId: string;
    workspaceId: string;
    trigger: "manual" | "scheduled" | "poll";
  },
): Promise<WorkbookSyncResult> {
  const { data: workbook } = await admin
    .from("connected_workbooks")
    .select(
      "id, workspace_id, destination_id, external_ref, sheet_map, direction, status",
    )
    .eq("id", input.workbookId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!workbook) return { ok: false, error: "workbook not found" };
  if (workbook.status === "paused" || workbook.status === "disconnected") {
    return { ok: false, error: `workbook is ${workbook.status}` };
  }

  const { data: destination } = await admin
    .from("integration_destinations")
    .select("id, provider")
    .eq("id", workbook.destination_id)
    .maybeSingle();
  const provider = (destination?.provider ?? "manual_file") as WorkbookProvider;

  const { data: run } = await admin
    .from("integration_sync_runs")
    .insert({
      workspace_id: input.workspaceId,
      destination_id: workbook.destination_id,
      connected_workbook_id: workbook.id,
      trigger: input.trigger,
      direction: workbook.direction,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  const syncRunId = run?.id as string | undefined;

  const finish = async (
    status: "succeeded" | "partial" | "failed",
    counts: Record<string, number>,
    error: Record<string, unknown> | null,
    externalRef?: string,
  ) => {
    if (syncRunId) {
      await admin
        .from("integration_sync_runs")
        .update({
          status,
          counts,
          error,
          finished_at: new Date().toISOString(),
        })
        .eq("id", syncRunId);
    }
    await admin
      .from("connected_workbooks")
      .update({
        last_sync_run_id: syncRunId ?? null,
        external_ref: externalRef ?? workbook.external_ref,
        status: status === "failed"
          ? "error"
          : status === "partial"
          ? "needs_auth"
          : "active",
      })
      .eq("id", workbook.id);
    await admin.from("integration_events").insert({
      workspace_id: input.workspaceId,
      kind: status === "succeeded" ? "workbook.synced" : "workbook.sync_failed",
      severity: status === "succeeded" ? "info" : "warning",
      ref_type: "connected_workbook",
      ref_id: workbook.id,
      summary: status === "succeeded"
        ? `Workbook synced — ${counts.updated ?? 0} sheets updated`
        : `Workbook sync ${status}`,
      context: { provider, trigger: input.trigger },
    });
  };

  if (workbook.direction === "import") {
    await finish("partial", { note: 0 }, { code: "inbound_not_wired" });
    return { ok: false, error: "inbound sync is not available yet", syncRunId };
  }

  try {
    const period = resolvePeriod({ kind: "relative", preset: "all" }, new Date());
    const dataset = await buildExportDataset(
      admin,
      input.workspaceId,
      { from: period.from, to: period.to, accountIds: null, directions: null },
      period.label,
    );
    const sheets = datasetToSheetRows(dataset, normalizeSheetMap(workbook.sheet_map));

    const adapter = getWorkbookAdapter(admin, {
      provider,
      workspaceId: input.workspaceId,
      workbookId: workbook.id,
    });
    const written = await adapter.writeAllSheets(workbook.external_ref, sheets);

    const counts = {
      updated: sheets.length,
      rows: dataset.transactions.length,
    };
    await finish("succeeded", counts, null, written.externalRef);
    return { ok: true, syncRunId: syncRunId ?? "", counts };
  } catch (err) {
    const code = (err as { code?: string })?.code === "provider_not_configured"
      ? "provider_not_configured"
      : "workbook_sync_failed";
    const status = code === "provider_not_configured" ? "partial" : "failed";
    await finish(status, { updated: 0 }, {
      code,
      message: err instanceof Error ? err.message.slice(0, 200) : "failed",
    });
    return { ok: false, error: code, syncRunId };
  }
}
