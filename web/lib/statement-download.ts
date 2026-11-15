import "server-only";

import { mobileAccessToken } from "./mobile-session-context";
import { supabaseServer } from "./supabase-server";
import { supabaseSession } from "./supabase-session-server";
import { recordStatementAudit } from "./statement-generation";
import {
  getOrRenderStatementArtifact,
  STATEMENT_LINE_COLUMNS,
  STATEMENT_ROW_COLUMNS,
  type StatementDocFormat,
} from "./statement-render";

// One generated statement -> a short-lived signed download URL. Shared by the
// web route (app/api/reports/statements/[id]/document, which redirects to it)
// and the mobile route (app/api/mobile/statements/[id]/document, which returns
// it as JSON).
//
// Ownership is verified by the caller's OWN session (RLS on `statements` -
// statements_select_member; under a mobile request that session is the bearer
// token's). Every statement_artifacts / storage operation then uses the
// service-role client because that table and bucket grant authenticated
// nothing at all. Every call returns a fresh signed URL, never a stable
// public one; the URL is never logged.

export const SIGNED_URL_TTL_SECONDS = 300;

export type StatementDownloadResult =
  | { ok: true; url: string; filename: string }
  | {
    ok: false;
    /** HTTP status the web route answers with. */
    status: 404 | 409 | 500;
    error: "not found" | "not ready" | "lookup failed" | "failed to generate document" | "failed to create download link";
  };

export async function createStatementDownload(
  id: string,
  format: StatementDocFormat,
): Promise<StatementDownloadResult> {
  const session = await supabaseSession();

  const { data: statement, error: stmtError } = await session
    .from("statements")
    .select(STATEMENT_ROW_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (stmtError) {
    console.error("statement document: lookup failed", stmtError.message);
    return { ok: false, status: 500, error: "lookup failed" };
  }
  if (!statement) return { ok: false, status: 404, error: "not found" };
  if (statement.status !== "ready") {
    return { ok: false, status: 409, error: "not ready" };
  }

  const { data: lineRows, error: lineError } = await session
    .from("statement_transactions")
    .select(STATEMENT_LINE_COLUMNS)
    .eq("statement_id", id)
    .order("sort_index", { ascending: true });

  if (lineError) {
    console.error("statement document: lines failed", lineError.message);
    return { ok: false, status: 500, error: "lookup failed" };
  }

  const admin = supabaseServer();
  const artifact = await getOrRenderStatementArtifact(
    admin,
    statement,
    lineRows ?? [],
    format,
  );
  if (!artifact.ok) {
    return { ok: false, status: 500, error: "failed to generate document" };
  }

  const filename = `OneLedger-Statement-${statement.statement_id}.${format}`;
  const { data: signed, error: signError } = await admin.storage
    .from("statement-artifacts")
    .createSignedUrl(artifact.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: filename,
    });

  if (signError || !signed) {
    console.error("statement document: signed URL failed", signError?.message);
    return { ok: false, status: 500, error: "failed to create download link" };
  }

  // A bearer client has no stored session, so getUser() must be handed the
  // token explicitly or the audit row would silently never be written for
  // mobile. On the web the cookie session answers and no token is passed.
  const { data: { user } } = await session.auth.getUser(
    mobileAccessToken() ?? undefined,
  );
  if (user) {
    await recordStatementAudit(admin, {
      workspaceId: statement.workspace_id,
      actorUserId: user.id,
      eventType: "statement.downloaded",
      statementUuid: statement.id,
      metadata: { statementId: statement.statement_id, format },
    });
  }

  return { ok: true, url: signed.signedUrl, filename };
}
