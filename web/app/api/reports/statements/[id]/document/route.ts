import { NextRequest, NextResponse } from "next/server";
import { isFinancialStatementsEnabled } from "../../../../../../lib/financial-statements";
import { createStatementDownload } from "../../../../../../lib/statement-download";

// Download one generated statement as PDF (default) or CSV. Ownership,
// rendering, caching, the short-lived signed URL and the audit event all live
// in lib/statement-download.ts (shared with the mobile app's route).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isFinancialStatementsEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "csv"
    ? "csv"
    : "pdf";

  const result = await createStatementDownload(id, format);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, {
      status: result.status,
    });
  }
  return NextResponse.redirect(result.url);
}
