import { NextRequest, NextResponse } from "next/server";
import { createReportDownload } from "../../../../../lib/report-download";

// PDF download for one report (Phase H). Ownership, rendering, caching and the
// short-lived signed URL all live in lib/report-download.ts (shared with the
// mobile app's route); this only turns the result into the web's response.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await createReportDownload(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.redirect(result.url);
}
