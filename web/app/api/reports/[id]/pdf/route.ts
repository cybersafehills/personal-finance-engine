import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getReportRunById } from "../../../../../lib/queries";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { formatDateKeyLabel, formatZonedDateTime } from "../../../../../lib/format";
import { REPORT_PDF_TEMPLATE_VERSION, renderReportPdf } from "../../../../../lib/report-pdf";

// PDF download for one report (Phase H). Authenticated via the caller's
// own session, NOT the cron secret - report ownership is verified by
// getReportRunById's existing RLS (report_runs_select_own), exactly the
// same check the report detail page itself relies on. Every subsequent
// operation (report_artifacts, storage) uses the service-role client
// because this table/bucket grants nothing to authenticated/anon at all
// (see the Phase K migration's own comment) - the ownership check above
// IS the security boundary for this route, not a redundant nicety.
//
// Lazily generated and cached: the first request for a given report
// renders and stores the PDF; every subsequent request reuses the stored
// object and only issues a fresh short-lived signed URL (master prompt
// §27 - never a permanently public URL).
const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const report = await getReportRunById(id);
  if (!report) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!report.report_payload) {
    return NextResponse.json({ error: "report not yet generated" }, { status: 409 });
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
    return NextResponse.json({ error: "failed to look up report artifact" }, { status: 500 });
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

    // A concurrent request already uploaded the same path - reuse it
    // rather than treating this as a failure.
    if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
      console.error("report pdf: upload failed", uploadError.message);
      return NextResponse.json({ error: "failed to generate report PDF" }, { status: 500 });
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
    // report_artifacts_unique_format is exactly what's supposed to
    // prevent a duplicate row here.
    if (insertError && insertError.code !== "23505") {
      console.error("report pdf: artifact insert failed", insertError.message);
    }

    storagePath = candidatePath;
  }

  const { data: signed, error: signError } = await admin.storage
    .from("report-artifacts")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    console.error("report pdf: signed URL failed", signError?.message);
    return NextResponse.json({ error: "failed to create download link" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
