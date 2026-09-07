import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconstructStatementPeriod } from "./statement-period";
import {
  buildStatementCsv,
  type StatementDocData,
  type StatementDocLine,
} from "./statement-document";
import {
  renderStatementPdf,
  STATEMENT_PDF_TEMPLATE_VERSION,
} from "./statement-pdf";

// Shared "assemble the render model + render + cache" path for a single
// statement document. Used by the download route and by the Financial
// Pack builder (lib/statement-pack.ts). Every call takes a SERVICE-ROLE
// client - the caller is responsible for having verified the caller may
// see the statement (RLS on `statements`) BEFORE invoking this.

export type StatementDocFormat = "pdf" | "csv";

export const STATEMENT_ROW_COLUMNS =
  "id, statement_id, workspace_id, created_by, statement_type, scope, period_start, period_end, timezone, currency, generated_at, created_at, opening_balance_minor, closing_balance_minor, total_credit_minor, total_debit_minor, total_fees_minor, transaction_count, reconciles, per_currency, source_metadata, coverage_metadata, status, verification_token";

export const STATEMENT_LINE_COLUMNS =
  "occurred_at, display_description, original_description, reference, direction, principal_effect_minor, fee_effect_minor, running_balance_minor, category, sort_index";

// Loose row shapes from untyped supabase-js selects; every consumer of a
// StatementDocData downstream is fully typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export async function buildStatementDocData(
  admin: SupabaseClient,
  statement: Row,
  lineRows: Row[],
): Promise<StatementDocData> {
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", statement.created_by)
    .maybeSingle();

  const lines: StatementDocLine[] = (lineRows ?? []).map((r) => ({
    occurredAt: r.occurred_at,
    displayDescription: r.display_description ?? "",
    originalDescription: r.original_description ?? null,
    reference: r.reference ?? null,
    direction: r.direction,
    principalEffectMinor: Number(r.principal_effect_minor ?? 0),
    feeEffectMinor: Number(r.fee_effect_minor ?? 0),
    runningBalanceMinor: r.running_balance_minor === null
      ? null
      : Number(r.running_balance_minor),
    category: r.category ?? null,
  }));

  const period = reconstructStatementPeriod(
    new Date(statement.period_start),
    new Date(statement.period_end),
    statement.timezone,
  );

  return {
    statementId: statement.statement_id,
    statementType: statement.statement_type,
    scope: statement.scope,
    accountHolderName: profile?.display_name ?? null,
    periodLabel: period.label,
    periodStartIso: statement.period_start,
    periodEndIso: statement.period_end,
    timezone: statement.timezone,
    currency: statement.currency,
    generatedAtIso: statement.generated_at ?? statement.created_at,
    openingBalanceMinor: statement.opening_balance_minor === null
      ? null
      : Number(statement.opening_balance_minor),
    closingBalanceMinor: statement.closing_balance_minor === null
      ? null
      : Number(statement.closing_balance_minor),
    totalCreditsMinor: Number(statement.total_credit_minor),
    totalDebitsMinor: Number(statement.total_debit_minor),
    totalFeesMinor: Number(statement.total_fees_minor),
    netMovementMinor: Number(statement.total_credit_minor) -
      Number(statement.total_debit_minor) -
      Number(statement.total_fees_minor),
    transactionCount: Number(statement.transaction_count),
    reconciles: statement.reconciles,
    perCurrency: statement.per_currency ?? null,
    runningBalanceAvailable: lines.some((l) => l.runningBalanceMinor !== null),
    source: statement.source_metadata,
    coverage: statement.coverage_metadata,
    lines,
    verificationToken: statement.verification_token ?? null,
  };
}

export type ArtifactResult =
  | { ok: true; storagePath: string; bytes: Buffer }
  | { ok: false; error: string };

/**
 * The stored document for (statement, format): served from the cache if
 * present, otherwise rendered, uploaded to the private bucket, its
 * metadata + sha256 recorded, and returned. Always returns the bytes.
 */
export async function getOrRenderStatementArtifact(
  admin: SupabaseClient,
  statement: Row,
  lineRows: Row[],
  format: StatementDocFormat,
): Promise<ArtifactResult> {
  const statementUuid = statement.id as string;
  const contentType = format === "csv" ? "text/csv" : "application/pdf";
  const candidatePath = `statements/${statementUuid}.${format}`;

  const { data: existing } = await admin
    .from("statement_artifacts")
    .select("storage_path")
    .eq("statement_id", statementUuid)
    .eq("format", format)
    .maybeSingle();

  if (existing?.storage_path) {
    const { data: blob, error } = await admin.storage
      .from("statement-artifacts")
      .download(existing.storage_path);
    if (error || !blob) {
      return { ok: false, error: "cached artifact could not be read" };
    }
    return {
      ok: true,
      storagePath: existing.storage_path,
      bytes: Buffer.from(await blob.arrayBuffer()),
    };
  }

  let bytes: Buffer;
  try {
    const data = await buildStatementDocData(admin, statement, lineRows);
    bytes = format === "csv"
      ? Buffer.from(buildStatementCsv(data), "utf-8")
      : await renderStatementPdf(data);
  } catch (renderError) {
    console.error(
      "[statement.monitor] render_failed",
      { statementId: statement.statement_id, format },
      renderError,
    );
    return { ok: false, error: "render failed" };
  }

  const { error: uploadError } = await admin.storage
    .from("statement-artifacts")
    .upload(candidatePath, bytes, { contentType, upsert: false });
  if (
    uploadError &&
    !uploadError.message.toLowerCase().includes("already exists")
  ) {
    console.error("statement artifact: upload failed", uploadError.message);
    return { ok: false, error: "upload failed" };
  }

  const { error: insertError } = await admin.from("statement_artifacts").insert(
    {
      statement_id: statementUuid,
      format,
      storage_path: candidatePath,
      mime_type: contentType,
      byte_size: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      template_version: format === "pdf" ? STATEMENT_PDF_TEMPLATE_VERSION : 1,
    },
  );
  if (insertError && insertError.code !== "23505") {
    console.error("statement artifact: insert failed", insertError.message);
  }

  return { ok: true, storagePath: candidatePath, bytes };
}
