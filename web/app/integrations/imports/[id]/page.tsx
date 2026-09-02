import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { ImportMappingForm } from "../../../../components/ImportMappingForm";
import {
  ImportStagingReview,
  type StagingRecord,
} from "../../../../components/ImportStagingReview";
import { formatDateTime } from "../../../../lib/format";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../lib/integrations/gate";
import {
  findMatchingImportTemplate,
  getImportBatch,
  listImportTargetSources,
} from "../../../../lib/integrations/queries";
import type { DataProfile } from "../../../../lib/integrations/profile";
import {
  type ImportColumnMapping,
  suggestMapping,
  TEMPLATE_AUTO_APPLY_THRESHOLD,
} from "../../../../lib/integrations/mapping";
import type { ImportRecord } from "../../../../lib/integrations/model";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toStaging(record: ImportRecord): StagingRecord {
  const rawIssues = (record.validation as { issues?: unknown }).issues;
  return {
    id: record.id,
    rowIndex: record.rowIndex,
    status: record.status,
    cells: (record.rawCells.cells as string[] | undefined) ?? [],
    issues: Array.isArray(rawIssues)
      ? (rawIssues as { severity: string; message: string }[])
      : [],
    matchConfidence:
      (record.match as { confidence?: string } | undefined)?.confidence ?? null,
  };
}

export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!isImportStudioEnabled(workspaceId)) notFound();

  const result = await getImportBatch(id);
  if (!result) notFound();
  const { batch, records } = result;

  const profile = batch.detected as Partial<
    DataProfile & { truncated: boolean; stagedRowCount: number }
  >;
  const headers = profile.headers ?? [];
  const counts = batch.rowCounts;

  const validated = batch.status === "validated";
  const committed = batch.status === "imported" || batch.status === "rolled_back";
  const showMappingForm = batch.status === "profiled" ||
    batch.status === "mapped" ||
    validated;

  // Starting mapping: persisted -> matched template -> header guess.
  const persisted = batch.mapping as Partial<ImportColumnMapping>;
  let initialMapping: ImportColumnMapping;
  let matchedTemplateName: string | null = null;
  if (persisted && persisted.columns) {
    initialMapping = persisted as ImportColumnMapping;
  } else {
    const match = await findMatchingImportTemplate(headers);
    if (
      match &&
      match.score >= TEMPLATE_AUTO_APPLY_THRESHOLD &&
      (match.template.mapping as Partial<ImportColumnMapping>).columns
    ) {
      initialMapping = match.template.mapping as ImportColumnMapping;
      matchedTemplateName = match.template.name;
    } else {
      initialMapping = suggestMapping(headers, profile.currencyGuess ?? null);
    }
  }

  const targetSources = validated || committed
    ? await listImportTargetSources()
    : [];

  return (
    <div>
      <PageHeader
        title={batch.originalFilename}
        subtitle={`${batch.sourceKind.toUpperCase()} · uploaded ${formatDateTime(batch.createdAt)}`}
        backHref="/integrations/imports"
        backLabel="Imports"
        action={<Badge>{batch.status.replace("_", " ")}</Badge>}
      />

      {batch.status === "failed" && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention"
        >
          This import could not be processed. No transactions were added.
        </p>
      )}

      <section aria-labelledby="detection" className="mb-6">
        <h2 id="detection" className="mb-2 text-sm font-semibold text-text-primary">
          {committed ? "Summary" : "What we detected"}
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Rows" value={String(profile.rowCount ?? records.length)} />
          <Stat
            label="Date range"
            value={
              profile.dateRange
                ? `${fmtDate(profile.dateRange.start)} – ${fmtDate(profile.dateRange.end)}`
                : "—"
            }
          />
          <Stat label="Likely currency" value={profile.currencyGuess ?? "—"} />
          {validated || committed ? (
            <>
              <Stat label="Imported" value={String(counts.imported ?? 0)} />
              <Stat
                label="Possible duplicates"
                value={String(counts.possible_duplicate ?? 0)}
              />
              <Stat label="To review" value={String(counts.needs_review ?? 0)} />
            </>
          ) : (
            <>
              <Stat
                label="Probable type"
                value={
                  profile.probableType === "bank_transactions"
                    ? "Bank transactions"
                    : "Unrecognised"
                }
              />
              <Stat label="Ready to map" value={String(profile.readyRows ?? 0)} />
              <Stat
                label="Need attention"
                value={String(
                  (profile.invalidRows ?? 0) +
                    (profile.repeatedHeaderRows ?? 0) +
                    (profile.blankRows ?? 0),
                )}
              />
            </>
          )}
        </dl>
        {profile.truncated && (
          <p className="mt-2 text-xs text-text-muted">
            Only the first {profile.stagedRowCount} rows were staged for this
            preview release.
          </p>
        )}
      </section>

      {showMappingForm && (
        <section aria-labelledby="mapping" className="mb-8">
          <details open={!validated}>
            <summary className="mb-3 cursor-pointer text-sm font-semibold text-text-primary">
              {validated ? "Adjust the column mapping" : "Map the columns"}
            </summary>
            <ImportMappingForm
              batchId={batch.id}
              headers={headers}
              sampleRows={records
                .slice(0, 30)
                .map((r) => (r.rawCells.cells as string[] | undefined) ?? [])}
              initialMapping={initialMapping}
              matchedTemplateName={matchedTemplateName}
            />
          </details>
        </section>
      )}

      {(validated || committed) && (
        <section aria-labelledby="staging" className="mb-6">
          <h2 id="staging" className="mb-3 text-sm font-semibold text-text-primary">
            {committed ? "Imported rows" : "Review and import"}
          </h2>
          <ImportStagingReview
            batchId={batch.id}
            batchStatus={batch.status}
            headers={headers}
            records={records.map(toStaging)}
            targetSources={targetSources}
            currentSourceId={batch.financialSourceId}
          />
        </section>
      )}

      {!validated && !committed && (
        <div className="rounded-card border border-border-subtle bg-surface p-4">
          <p className="text-sm text-text-muted">
            Map the columns above, then apply the mapping to review and import.
            Nothing enters your ledger until you do.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface px-3 py-2.5">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}
