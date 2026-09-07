import { NextRequest, NextResponse } from "next/server";
import { isFinancialStatementsEnabled } from "../../../../../../lib/financial-statements";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../../lib/supabase-server";
import { recordStatementAudit } from "../../../../../../lib/statement-generation";
import {
  getOrRenderStatementArtifact,
  STATEMENT_LINE_COLUMNS,
  STATEMENT_ROW_COLUMNS,
  type StatementDocFormat,
} from "../../../../../../lib/statement-render";

// Download one generated statement as PDF (default) or CSV.
//
// Ownership is verified by the caller's OWN session (RLS on `statements` -
// statements_select_member); every statement_artifacts / storage
// operation then uses the service-role client because that table and
// bucket grant authenticated nothing at all. The document is rendered
// lazily on first request and cached; every request returns only a
// short-lived signed URL, never a stable public one (master prompt
// sections 26 / 27). The stored sha256 is the integrity fingerprint
// (section 20). Assembly + render + cache live in lib/statement-render.ts,
// shared with the Financial Pack builder.

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isFinancialStatementsEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { id } = await params;
  const format: StatementDocFormat =
    new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "pdf";

  const session = await supabaseSession();

  const { data: statement, error: stmtError } = await session
    .from("statements")
    .select(STATEMENT_ROW_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (stmtError) {
    console.error("statement document: lookup failed", stmtError.message);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!statement) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (statement.status !== "ready") {
    return NextResponse.json({ error: "not ready" }, { status: 409 });
  }

  const { data: lineRows, error: lineError } = await session
    .from("statement_transactions")
    .select(STATEMENT_LINE_COLUMNS)
    .eq("statement_id", id)
    .order("sort_index", { ascending: true });

  if (lineError) {
    console.error("statement document: lines failed", lineError.message);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }

  const admin = supabaseServer();
  const artifact = await getOrRenderStatementArtifact(
    admin,
    statement,
    lineRows ?? [],
    format,
  );
  if (!artifact.ok) {
    return NextResponse.json({ error: "failed to generate document" }, {
      status: 500,
    });
  }

  const filename = `OneLedger-Statement-${statement.statement_id}.${format}`;
  const { data: signed, error: signError } = await admin.storage
    .from("statement-artifacts")
    .createSignedUrl(artifact.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: filename,
    });

  if (signError || !signed) {
    console.error("statement document: signed URL failed", signError?.message);
    return NextResponse.json({ error: "failed to create download link" }, {
      status: 500,
    });
  }

  const { data: { user } } = await session.auth.getUser();
  if (user) {
    await recordStatementAudit(admin, {
      workspaceId: statement.workspace_id,
      actorUserId: user.id,
      eventType: "statement.downloaded",
      statementUuid: statement.id,
      metadata: { statementId: statement.statement_id, format },
    });
  }

  return NextResponse.redirect(signed.signedUrl);
}
