import "server-only";

import JSZip from "jszip";
import { supabaseServer } from "../../supabase-server.ts";
import {
  buildExportDataset,
  type ExportFilters,
} from "../export/query.ts";
import { buildCsv, buildXlsx, EXPORT_SHEETS } from "../export/workbook.ts";
import { fireWebhookEvent } from "../webhooks/dispatch.ts";
import {
  type AccountantCoverData,
  renderAccountantCoverPdf,
} from "./cover-pdf.tsx";
import type {
  AccountantPackageFormat,
  AccountantPackageManifest,
} from "./model.ts";

const BUCKET = "integration-accountant-packages";
const ZIP_NAME = "oneledger-accountant-package.zip";

type Admin = ReturnType<typeof supabaseServer>;

async function workspaceName(admin: Admin, workspaceId: string): Promise<string> {
  const { data } = await admin
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  return (data?.name as string) ?? "Workspace";
}

/**
 * Open reconciliation work for the period package's cover: balance-drift
 * checkpoints (mismatch / pending_review) for this workspace's accounts,
 * plus open connected-workbook sync conflicts. Uses the service-role
 * client, so both queries pin the workspace explicitly.
 */
async function reconciliationCounts(
  admin: Admin,
  workspaceId: string,
): Promise<{ openItems: number; balanceMismatches: number }> {
  const { data: accountRows } = await admin
    .from("accounts")
    .select("id")
    .eq("workspace_id", workspaceId);
  const accountIds = (accountRows ?? []).map((a) => a.id as string);

  let balanceMismatches = 0;
  if (accountIds.length > 0) {
    const { count } = await admin
      .from("balance_reconciliations")
      .select("id", { count: "exact", head: true })
      .in("account_id", accountIds)
      .in("status", ["mismatch", "pending_review"]);
    balanceMismatches = count ?? 0;
  }

  const { count: conflictCount } = await admin
    .from("integration_conflicts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "open");

  return {
    balanceMismatches,
    openItems: balanceMismatches + (conflictCount ?? 0),
  };
}

/**
 * Build one accountant package: pull the period's ledger, assemble a ZIP
 * (transactions CSV + multi-sheet XLSX + a PDF cover + a redacted
 * MANIFEST.json), upload it to the private bucket, and mark the row ready
 * (or failed). Runs inline from createAccountantPackage for normal-sized
 * periods and from the build-accountant-packages cron otherwise.
 */
export async function runAccountantPackageBuild(
  packageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = supabaseServer();

  const { data: pkg, error: loadError } = await admin
    .from("accountant_packages")
    .select("id, workspace_id, period_start, period_end")
    .eq("id", packageId)
    .maybeSingle();
  if (loadError || !pkg) {
    return { ok: false, error: "Accountant package not found." };
  }

  await admin
    .from("accountant_packages")
    .update({ status: "building", started_at: new Date().toISOString() })
    .eq("id", packageId);

  try {
    const periodFrom = `${pkg.period_start}T00:00:00.000Z`;
    const periodTo = `${pkg.period_end}T23:59:59.999Z`;
    const periodLabel = `${pkg.period_start} — ${pkg.period_end}`;

    const filters: ExportFilters = {
      from: periodFrom,
      to: periodTo,
      accountIds: null,
      directions: null,
    };

    const [dataset, wsName, recon] = await Promise.all([
      buildExportDataset(admin, pkg.workspace_id, filters, periodLabel),
      workspaceName(admin, pkg.workspace_id),
      reconciliationCounts(admin, pkg.workspace_id),
    ]);

    const csv = buildCsv(dataset);
    const xlsx = await buildXlsx(dataset, [...EXPORT_SHEETS]);

    const generatedAt = new Date();
    const contents = [
      "transactions.csv — every ledger row for the period",
      "workbook.xlsx — Summary / Transactions / Income / Expenses / Categories / Accounts",
      "cover.pdf — this summary",
    ];
    const cover: AccountantCoverData = {
      workspaceName: wsName,
      periodLabel,
      periodFrom,
      periodTo,
      generatedAtLabel: generatedAt.toISOString().replace("T", " ").slice(0, 16) +
        " UTC",
      transactionCount: dataset.transactions.length,
      accountCount: dataset.accounts.length,
      contents,
      reconciliation: recon,
    };
    const coverPdf = await renderAccountantCoverPdf(cover);

    const formats: AccountantPackageFormat[] = ["csv", "xlsx", "pdf"];
    const manifest: AccountantPackageManifest = {
      periodLabel,
      transactionCount: dataset.transactions.length,
      sections: [...EXPORT_SHEETS],
      reconciliation: {
        openItems: recon.openItems,
        balanceMismatches: recon.balanceMismatches,
      },
      generatedAt: generatedAt.toISOString(),
    };

    const zip = new JSZip();
    zip.file("transactions.csv", csv);
    zip.file("workbook.xlsx", xlsx);
    zip.file("cover.pdf", coverPdf);
    zip.file("MANIFEST.json", JSON.stringify(manifest, null, 2));
    const zipBytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const storagePath =
      `${pkg.workspace_id}/${packageId}/${ZIP_NAME}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, zipBytes, {
        contentType: "application/zip",
        upsert: true,
      });
    if (uploadError) throw new Error(uploadError.message);

    await admin
      .from("accountant_packages")
      .update({
        status: "ready",
        storage_path: storagePath,
        formats,
        manifest,
        row_count: dataset.transactions.length,
        byte_size: zipBytes.byteLength,
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", packageId);

    await admin.from("integration_events").insert({
      workspace_id: pkg.workspace_id,
      kind: "accountant_package.completed",
      severity: "info",
      ref_type: "accountant_package",
      ref_id: packageId,
      summary:
        `Accountant package ready — ${dataset.transactions.length} transactions (${periodLabel})`,
      context: {
        rowCount: dataset.transactions.length,
        byteSize: zipBytes.byteLength,
      },
    });

    fireWebhookEvent(admin, {
      workspaceId: pkg.workspace_id,
      type: "accountant_package.completed",
      eventRef: packageId,
      data: {
        package_id: packageId,
        period_start: pkg.period_start,
        period_end: pkg.period_end,
        row_count: dataset.transactions.length,
        byte_size: zipBytes.byteLength,
      },
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("runAccountantPackageBuild failed", packageId, message);
    await admin
      .from("accountant_packages")
      .update({
        status: "failed",
        error: { message: message.slice(0, 500) },
        completed_at: new Date().toISOString(),
      })
      .eq("id", packageId);
    await admin.from("integration_events").insert({
      workspace_id: pkg.workspace_id,
      kind: "accountant_package.failed",
      severity: "error",
      ref_type: "accountant_package",
      ref_id: packageId,
      summary: "Accountant package failed to build",
      context: {},
    });
    await notifyPackageCreator(admin, pkg.workspace_id, packageId);
    return { ok: false, error: "The accountant package could not be built." };
  }
}

async function notifyPackageCreator(
  admin: Admin,
  workspaceId: string,
  packageId: string,
): Promise<void> {
  const { data: pkg } = await admin
    .from("accountant_packages")
    .select("created_by, period_start, period_end")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg?.created_by) return;
  await admin.from("notifications").insert({
    workspace_id: workspaceId,
    user_id: pkg.created_by,
    event_key: "integration.accountant_package_failed",
    channel: "in_app",
    title: "An accountant package failed to build",
    body:
      `The package for ${pkg.period_start} — ${pkg.period_end} did not finish. You can try building it again.`,
    resource_type: "accountant_package",
    resource_id: packageId,
  });
}
