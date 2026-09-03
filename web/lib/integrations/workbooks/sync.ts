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
import { nextAttemptState } from "../sync-engine.ts";

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
    /** attempt number of the retry chain this run belongs to (0 = first). */
    attempt?: number;
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
      attempt: input.attempt ?? 0,
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
    const errCode = (err as { code?: string })?.code;
    const code = errCode === "provider_not_configured"
      ? "provider_not_configured"
      : errCode === "provider_upload_not_implemented"
      ? "provider_upload_not_implemented"
      : "workbook_sync_failed";
    const message = err instanceof Error ? err.message.slice(0, 200) : "failed";

    // Dark-provider states: a `partial` run, no retry.
    if (code === "provider_not_configured" || code === "provider_upload_not_implemented") {
      await finish("partial", counts, { code, message });
      return { ok: false, error: code, syncRunId };
    }

    // Real failure: let the retry policy decide.
    const state = nextAttemptState(input.attempt ?? 0, code, Date.now());
    if (syncRunId) {
      await admin
        .from("integration_sync_runs")
        .update({
          status: state.status,
          counts,
          error: { code, message },
          attempt: state.attempt,
          next_attempt_at: state.nextAttemptAtMs
            ? new Date(state.nextAttemptAtMs).toISOString()
            : null,
          finished_at: state.status === "failed" ? new Date().toISOString() : null,
        })
        .eq("id", syncRunId);
    }
    const wbStatus = state.markNeedsAuth
      ? "needs_auth"
      : state.status === "failed"
      ? "error"
      : "active";
    await admin
      .from("connected_workbooks")
      .update({ last_sync_run_id: syncRunId ?? null, status: wbStatus })
      .eq("id", workbook.id);
    if (state.markNeedsAuth) {
      await admin
        .from("integration_destinations")
        .update({ status: "needs_auth", last_error_code: code })
        .eq("id", workbook.destination_id);
      await notifyWorkbookOwner(admin, {
        workspaceId: input.workspaceId,
        workbookId: workbook.id,
        title: "A connected workbook needs re-authorising",
        body: "A sync failed because the workbook’s connection is no longer valid.",
      });
    }
    await admin.from("integration_events").insert({
      workspace_id: input.workspaceId,
      kind: "workbook.sync_failed",
      severity: "warning",
      ref_type: "connected_workbook",
      ref_id: workbook.id,
      summary: state.status === "queued"
        ? `Workbook sync failed — retrying (attempt ${state.attempt})`
        : "Workbook sync failed",
      context: { provider, code, trigger: input.trigger },
    });
    return { ok: false, error: code, syncRunId };
  }
}

async function notifyWorkbookOwner(
  admin: SupabaseClient,
  p: { workspaceId: string; workbookId: string; title: string; body: string },
): Promise<void> {
  const { data: wb } = await admin
    .from("connected_workbooks")
    .select("created_by")
    .eq("id", p.workbookId)
    .maybeSingle();
  if (!wb?.created_by) return;
  await admin.from("notifications").insert({
    workspace_id: p.workspaceId,
    user_id: wb.created_by,
    event_key: "integration.workbook_needs_auth",
    channel: "in_app",
    title: p.title,
    body: p.body,
    resource_type: "connected_workbook",
    resource_id: p.workbookId,
  });
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
