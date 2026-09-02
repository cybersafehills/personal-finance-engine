import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { ImportMappingForm } from "../../../../components/ImportMappingForm";
import { formatDateTime } from "../../../../lib/format";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../lib/integrations/gate";
import {
  findMatchingImportTemplate,
  getImportBatch,
} from "../../../../lib/integrations/queries";
import type { DataProfile } from "../../../../lib/integrations/profile";
import {
  type ImportColumnMapping,
  suggestMapping,
  TEMPLATE_AUTO_APPLY_THRESHOLD,
} from "../../../../lib/integrations/mapping";
import type {
  ImportRecord,
  ImportRecordStatus,
} from "../../../../lib/integrations/model";

export const dynamic = "force-dynamic";

const RECORD_BADGE: Partial<
  Record<ImportRecordStatus, "neutral" | "attention" | "positive">
> = {
  ready: "positive",
  needs_review: "neutral",
  invalid: "attention",
};

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function issues(record: ImportRecord): { severity: string; message: string }[] {
  const raw = (record.validation as { issues?: unknown }).issues;
  return Array.isArray(raw)
    ? (raw as { severity: string; message: string }[])
    : [];
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
  const preview = records.slice(0, 25);

  // Resolve the mapping to start from.
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

  const showForm = batch.status === "profiled" ||
    batch.status === "mapped" ||
    batch.status === "validated";
  const validated = batch.status === "validated";
  const counts = batch.rowCounts;

  return (
    <div>
      <PageHeader
        title={batch.originalFilename}
        subtitle={`${batch.sourceKind.toUpperCase()} · uploaded ${formatDateTime(batch.createdAt)}`}
        backHref="/integrations/imports"
        backLabel="Imports"
        action={<Badge>{batch.status}</Badge>}
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
          What we detected
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
          {validated ? (
            <>
              <Stat label="Ready" value={String(counts.ready ?? 0)} />
              <Stat label="To review" value={String(counts.needs_review ?? 0)} />
              <Stat label="Invalid" value={String(counts.invalid ?? 0)} />
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

      {showForm && (
        <section aria-labelledby="mapping" className="mb-8">
          <h2 id="mapping" className="mb-3 text-sm font-semibold text-text-primary">
            {validated ? "Adjust the column mapping" : "Map the columns"}
          </h2>
          <ImportMappingForm
            batchId={batch.id}
            headers={headers}
            sampleRows={records
              .slice(0, 30)
              .map((r) => (r.rawCells.cells as string[] | undefined) ?? [])}
            initialMapping={initialMapping}
            matchedTemplateName={matchedTemplateName}
          />
        </section>
      )}

      {preview.length > 0 && (
        <section aria-labelledby="preview" className="mb-6">
          <h2 id="preview" className="mb-2 text-sm font-semibold text-text-primary">
            Preview {validated ? "(after mapping)" : ""}
          </h2>
          <div className="overflow-x-auto rounded-card border border-border-subtle">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-background text-text-muted">
                <tr>
                  {validated && <th className="px-3 py-2 font-medium">Status</th>}
                  {headers.map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h || `Col ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((record) => {
                  const cells =
                    (record.rawCells.cells as string[] | undefined) ?? [];
                  const rowIssues = issues(record);
                  return (
                    <tr key={record.id} className="border-t border-border-subtle align-top">
                      {validated && (
                        <td className="px-3 py-1.5">
                          <Badge variant={RECORD_BADGE[record.status] ?? "neutral"}>
                            {record.status.replace("_", " ")}
                          </Badge>
                          {rowIssues.length > 0 && (
                            <ul className="mt-1 text-[11px] text-text-muted">
                              {rowIssues.map((issue, i) => (
                                <li key={i}>{issue.message}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      )}
                      {headers.map((_, i) => (
                        <td key={i} className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                          {cells[i] ?? ""}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="rounded-card border border-border-subtle bg-surface p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            Review duplicates and import
          </span>
          <Badge>Coming soon</Badge>
        </div>
        <p className="text-sm text-text-muted">
          {validated
            ? "Duplicate detection, the staging inbox, and commit / rollback arrive in the next release. Your mapping and validation results are saved."
            : "Map the columns above first. Nothing enters your ledger until you review it."}
        </p>
      </div>
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
