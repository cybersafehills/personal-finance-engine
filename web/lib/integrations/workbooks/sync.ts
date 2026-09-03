import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePeriod } from "../export/period.ts";
import { buildExportDataset } from "../export/query.ts";
import { datasetToSheetRows } from "../export/workbook.ts";
import { normalizeSheetMap, type WorkbookProvider } from "./contract.ts";
import { getWorkbookAdapter } from "./registry.ts";
import {
  diffWorkbookAgainstLedger,
  type LedgerRowForDiff,
} from "./diff.ts";

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

  const doExport = workbook.direction === "export" ||
    workbook.direction === "two_way";
  const doImport = workbook.direction === "import" ||
    workbook.direction === "two_way";
  const sheetMap = normalizeSheetMap(workbook.sheet_map);
  const adapter = getWorkbookAdapter(admin, {
    provider,
    workspaceId: input.workspaceId,
    workbookId: workbook.id,
  });
  const counts: Record<string, number> = {};
  let externalRef = workbook.external_ref as string | null;

  try {
    if (doExport) {
      const period = resolvePeriod({ kind: "relative", preset: "all" }, new Date());
      const dataset = await buildExportDataset(
        admin,
        input.workspaceId,
        { from: period.from, to: period.to, accountIds: null, directions: null },
        period.label,
      );
      const sheets = datasetToSheetRows(dataset, sheetMap);
      const written = await adapter.writeAllSheets(externalRef, sheets);
      externalRef = written.externalRef;
      counts.updated = sheets.length;
      counts.rows = dataset.transactions.length;
    }

    if (doImport) {
      const sheets = await adapter.readAllSheets(externalRef);
      const txnSheetName = sheetMap.transactions ?? "Transactions";
      const txnSheet = sheets.find((s) => s.name === txnSheetName) ?? sheets[0];
      const ledger = await loadLedgerForDiff(admin, input.workspaceId);
      const diff = diffWorkbookAgainstLedger(txnSheet?.rows ?? [], ledger);
      if (diff.conflicts.length > 0 && syncRunId) {
        await admin.from("integration_conflicts").insert(
          diff.conflicts.map((c) => ({
            workspace_id: input.workspaceId,
            sync_run_id: syncRunId,
            connected_workbook_id: workbook.id,
            ref_type: c.refType,
            ref_id: c.refId,
            field: c.field,
            oneledger_value: c.oneledgerValue,
            external_value: c.externalValue,
            status: "open",
          })),
        );
      }
      counts.conflicts = diff.conflicts.length;
      counts.matched = diff.matched;
    }

    await finish("succeeded", counts, null, externalRef ?? undefined);
    return { ok: true, syncRunId: syncRunId ?? "", counts };
  } catch (err) {
    const code = (err as { code?: string })?.code === "provider_not_configured"
      ? "provider_not_configured"
      : "workbook_sync_failed";
    const status = code === "provider_not_configured" ? "partial" : "failed";
    await finish(status, counts, {
      code,
      message: err instanceof Error ? err.message.slice(0, 200) : "failed",
    });
    return { ok: false, error: code, syncRunId };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadLedgerForDiff(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<LedgerRowForDiff[]> {
  const { data } = await admin
    .from("transactions")
    .select(
      "id, occurred_at, counterparty_name, counterparty_reference, external_transaction_id, direction, amount_rwf, currency, category",
    )
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .limit(20000);
  return (data ?? []).map((t: any) => ({
    id: t.id,
    occurredAt: t.occurred_at,
    description: t.counterparty_name ?? null,
    reference: t.counterparty_reference ?? null,
    externalId: t.external_transaction_id ?? null,
    direction: t.direction,
    amountMinor: t.amount_rwf,
    currency: t.currency,
    category: t.category ?? null,
    accountName: null,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
