import "server-only";

import { supabaseServer } from "../../supabase-server";
import {
  type ExportPeriod,
  resolvePeriod,
} from "./period";
import {
  buildExportDataset,
  type ExportDirection,
  type ExportFilters,
} from "./query";
import { buildCsv, buildXlsx, EXPORT_SHEETS } from "./workbook";

const EXPORT_BUCKET = "integration-exports";

export type ExportJobConfig = {
  format: "csv" | "xlsx";
  period: ExportPeriod;
  accountIds?: string[] | null;
  directions?: ExportDirection[] | null;
  sheets?: string[] | null;
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "export";
}

/**
 * Generate one export job's file and mark it completed (or failed).
 * Idempotent-ish: re-running a completed job re-generates and overwrites.
 * Called inline from createExportJob for small exports and from the
 * run-export-jobs cron for large / queued ones.
 */
export async function runExportJob(
  jobId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = supabaseServer();

  const { data: job, error: loadError } = await admin
    .from("export_jobs")
    .select("id, workspace_id, config, format")
    .eq("id", jobId)
    .maybeSingle();
  if (loadError || !job) {
    return { ok: false, error: "Export job not found." };
  }

  const config = (job.config ?? {}) as ExportJobConfig;
  const format: "csv" | "xlsx" = job.format === "xlsx" ? "xlsx" : "csv";

  await admin
    .from("export_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    const period = resolvePeriod(
      config.period ?? { kind: "relative", preset: "previous_month" },
      new Date(),
    );
    const filters: ExportFilters = {
      from: period.from,
      to: period.to,
      accountIds: config.accountIds ?? null,
      directions: config.directions ?? null,
    };

    const dataset = await buildExportDataset(
      admin,
      job.workspace_id,
      filters,
      period.label,
    );

    let body: Uint8Array;
    let contentType: string;
    let ext: string;
    if (format === "xlsx") {
      const sheets = (config.sheets && config.sheets.length > 0)
        ? config.sheets
        : [...EXPORT_SHEETS];
      body = await buildXlsx(dataset, sheets);
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      ext = "xlsx";
    } else {
      body = new TextEncoder().encode(buildCsv(dataset));
      contentType = "text/csv; charset=utf-8";
      ext = "csv";
    }

    const filename = `oneledger-${slug(period.label)}-${
      new Date().toISOString().slice(0, 10)
    }.${ext}`;
    const storagePath = `${job.workspace_id}/${jobId}/${filename}`;

    const { error: uploadError } = await admin.storage
      .from(EXPORT_BUCKET)
      .upload(storagePath, body, { contentType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    await admin
      .from("export_jobs")
      .update({
        status: "completed",
        storage_path: storagePath,
        row_count: dataset.transactions.length,
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", jobId);

    await admin.from("integration_events").insert({
      workspace_id: job.workspace_id,
      kind: "export.completed",
      severity: "info",
      ref_type: "export_job",
      ref_id: jobId,
      summary: `Export ready — ${dataset.transactions.length} transactions (${period.label})`,
      context: { format, rowCount: dataset.transactions.length },
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("runExportJob failed", jobId, message);
    await admin
      .from("export_jobs")
      .update({
        status: "failed",
        error: { message: message.slice(0, 500) },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await admin.from("integration_events").insert({
      workspace_id: job.workspace_id,
      kind: "export.failed",
      severity: "error",
      ref_type: "export_job",
      ref_id: jobId,
      summary: "Export failed to generate",
      context: {},
    });
    return { ok: false, error: "The export could not be generated." };
  }
}
