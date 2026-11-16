import "server-only";

import { createHash } from "node:crypto";

import { formatDateKeyLabel, formatZonedDateTime } from "./format";
import { getReportRunById, getReportRunByIdStrict } from "./queries";
import { REPORT_PDF_TEMPLATE_VERSION, renderReportPdf } from "./report-pdf";
import { supabaseServer } from "./supabase-server";

// One report -> a short-lived signed PDF URL. Shared by the web route
// (app/api/reports/[id]/pdf, which redirects to it) and the mobile route
// (app/api/mobile/reports/[id]/document, which returns it as JSON).
//
// Authenticated via the caller's OWN session (under a mobile request, the bearer
// token's), NOT the cron secret: report ownership is verified by
// getReportRunById's RLS (report_runs_select_own), exactly the check the detail
// page relies on. Every later operation (report_artifacts, storage) uses the
// service-role client because that table and bucket grant authenticated nothing
// at all, so the ownership check above IS the security boundary.
//
// Lazily generated and cached: the first request renders and stores the PDF;
// every later one reuses the stored object and only issues a fresh short-lived
// signed URL (never a permanently public one). The URL is never logged.

export const REPORT_SIGNED_URL_TTL_SECONDS = 300;

export type ReportDownloadResult =
  | { ok: true; url: string }
  | {
    ok: false;
    /** HTTP status the web route answers with. */
    status: 404 | 409 | 500;
    error:
      | "not found"
      | "report not yet generated"
      | "failed to look up report artifact"
      | "failed to generate report PDF"
      | "failed to create download link";
  };

export async function createReportDownload(
  id: string,
  options: { strict?: boolean } = {},
): Promise<ReportDownloadResult> {
  // `strict` (the mobile API) lets a failed lookup THROW, so the app sees an
  // error it can retry instead of "not found"; the web route keeps its
  // long-standing behaviour (a failed lookup reads as 404).
  const report = options.strict ? await getReportRunByIdStrict(id) : await getReportRunById(id);
  if (!report) return { ok: false, status: 404, error: "not found" };
  if (!report.report_payload) {
    return { ok: false, status: 409, error: "report not yet generated" };
  }

  const admin = supabaseServer();

  const { data: existing, error: existingError } = await admin
    .from("report_artifacts")
    .select("storage_path")
    .eq("report_run_id", id)
    .eq("format", "pdf")
    .maybeSingle();

  if (existingError) {
    console.error("report pdf: artifact lookup failed", existingError.message);
    return { ok: false, status: 500, error: "failed to look up report artifact" };
  }

  let storagePath = existing?.storage_path ?? null;

  if (!storagePath) {
    const candidatePath = `reports/${id}.pdf`;

    const pdfBuffer = await renderReportPdf({
      payload: report.report_payload,
      aiCommentary: report.ai_payload,
      dateLabel: formatDateKeyLabel(report.report_payload.dateKey),
      generatedAtLabel: report.generated_at
        ? formatZonedDateTime(report.generated_at, report.timezone)
        : "—",
    });

    const { error: uploadError } = await admin.storage
      .from("report-artifacts")
      .upload(candidatePath, pdfBuffer, { contentType: "application/pdf", upsert: false });

    // A concurrent request already uploaded the same path - reuse it rather
    // than treating this as a failure.
    if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
      console.error("report pdf: upload failed", uploadError.message);
      return { ok: false, status: 500, error: "failed to generate report PDF" };
    }

    const { error: insertError } = await admin.from("report_artifacts").insert({
      report_run_id: id,
      format: "pdf",
      storage_path: candidatePath,
      mime_type: "application/pdf",
      byte_size: pdfBuffer.byteLength,
      checksum: createHash("sha256").update(pdfBuffer).digest("hex"),
      template_version: REPORT_PDF_TEMPLATE_VERSION,
    });

    // 23505 = a concurrent request already recorded this artifact - fine,
    // report_artifacts_unique_format is exactly what's supposed to prevent a
    // duplicate row here.
    if (insertError && insertError.code !== "23505") {
      console.error("report pdf: artifact insert failed", insertError.message);
    }

    storagePath = candidatePath;
  }

  const { data: signed, error: signError } = await admin.storage
    .from("report-artifacts")
    .createSignedUrl(storagePath, REPORT_SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    console.error("report pdf: signed URL failed", signError?.message);
    return { ok: false, status: 500, error: "failed to create download link" };
  }

  return { ok: true, url: signed.signedUrl };
}
