import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isFinancialStatementsEnabled } from "../../../../../../lib/financial-statements";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../../lib/supabase-server";
import { reconstructStatementPeriod } from "../../../../../../lib/statement-period";
import {
  buildStatementCsv,
  type StatementDocData,
  type StatementDocLine,
} from "../../../../../../lib/statement-document";
import {
  renderStatementPdf,
  STATEMENT_PDF_TEMPLATE_VERSION,
} from "../../../../../../lib/statement-pdf";

// Download one generated statement as PDF (default) or CSV.
//
// Same posture as app/api/reports/[id]/pdf/route.ts: ownership is verified
// by the caller's OWN session (RLS on `statements` - statements_select_member),
// then every statement_artifacts / storage operation uses the service-role
// client because that table and bucket grant authenticated nothing at all.
// The document is rendered lazily on first request and cached; every
// request returns only a short-lived signed URL, never a stable public
// one (master prompt sections 26 / 27). The stored sha256 is the
// integrity fingerprint (section 20).

const SIGNED_URL_TTL_SECONDS = 300;

type Format = "pdf" | "csv";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isFinancialStatementsEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { id } = await params;
  const format: Format =
    new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "pdf";

  const session = await supabaseSession();

  // Ownership check via RLS - a non-member sees nothing.
  const { data: statement, error: stmtError } = await session
    .from("statements")
    .select(
      "id, statement_id, workspace_id, created_by, statement_type, scope, period_start, period_end, timezone, currency, generated_at, created_at, opening_balance_minor, closing_balance_minor, total_credit_minor, total_debit_minor, total_fees_minor, transaction_count, reconciles, per_currency, source_metadata, coverage_metadata",
    )
    .eq("id", id)
    .maybeSingle();

  if (stmtError) {
    console.error("statement document: lookup failed", stmtError.message);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!statement) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: lineRows, error: lineError } = await session
    .from("statement_transactions")
    .select(
      "occurred_at, display_description, original_description, reference, direction, principal_effect_minor, fee_effect_minor, running_balance_minor, category, sort_index",
    )
    .eq("statement_id", id)
    .order("sort_index", { ascending: true });

  if (lineError) {
    console.error("statement document: lines failed", lineError.message);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }

  const admin = supabaseServer();

  // Reuse a cached artifact if one exists.
  const { data: existing, error: existingError } = await admin
    .from("statement_artifacts")
    .select("storage_path")
    .eq("statement_id", id)
    .eq("format", format)
    .maybeSingle();

  if (existingError) {
    console.error("statement document: artifact lookup failed", existingError.message);
    return NextResponse.json({ error: "failed to look up artifact" }, { status: 500 });
  }

  let storagePath = existing?.storage_path ?? null;

  if (!storagePath) {
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

    const data: StatementDocData = {
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
        Number(statement.total_debit_minor) - Number(statement.total_fees_minor),
      transactionCount: Number(statement.transaction_count),
      reconciles: statement.reconciles,
      perCurrency: statement.per_currency ?? null,
      runningBalanceAvailable: lines.some((l) => l.runningBalanceMinor !== null),
      source: statement.source_metadata,
      coverage: statement.coverage_metadata,
      lines,
    };

    const bytes = format === "csv"
      ? Buffer.from(buildStatementCsv(data), "utf-8")
      : await renderStatementPdf(data);

    const candidatePath = `statements/${id}.${format}`;
    const contentType = format === "csv" ? "text/csv" : "application/pdf";

    const { error: uploadError } = await admin.storage
      .from("statement-artifacts")
      .upload(candidatePath, bytes, { contentType, upsert: false });

    if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
      console.error("statement document: upload failed", uploadError.message);
      return NextResponse.json({ error: "failed to generate document" }, { status: 500 });
    }

    const { error: insertError } = await admin.from("statement_artifacts").insert({
      statement_id: id,
      format,
      storage_path: candidatePath,
      mime_type: contentType,
      byte_size: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      template_version: format === "pdf" ? STATEMENT_PDF_TEMPLATE_VERSION : 1,
    });

    // A concurrent request already recorded this artifact - fine, the
    // unique (statement_id, format) constraint is exactly that guard.
    if (insertError && insertError.code !== "23505") {
      console.error("statement document: artifact insert failed", insertError.message);
    }

    storagePath = candidatePath;
  }

  const filename = `OneLedger-Statement-${statement.statement_id}.${format}`;
  const { data: signed, error: signError } = await admin.storage
    .from("statement-artifacts")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: filename });

  if (signError || !signed) {
    console.error("statement document: signed URL failed", signError?.message);
    return NextResponse.json({ error: "failed to create download link" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
