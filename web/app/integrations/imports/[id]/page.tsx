import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { formatDateTime } from "../../../../lib/format";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../lib/integrations/gate";
import { getImportBatch } from "../../../../lib/integrations/queries";
import type { DataProfile } from "../../../../lib/integrations/profile";

export const dynamic = "force-dynamic";

const FIELD_LABELS: Record<string, string> = {
  date: "Date",
  description: "Description",
  amount: "Amount",
  direction: "Direction",
  balance: "Balance",
  reference: "Reference",
};

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  const suggested =
    (batch.mapping.suggested as Record<string, number | null> | undefined) ?? {};
  const headers = profile.headers ?? [];
  const preview = records.slice(0, 20);

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
        </dl>
        {profile.truncated && (
          <p className="mt-2 text-xs text-text-muted">
            Only the first {profile.stagedRowCount} rows were staged for this
            preview release.
          </p>
        )}
      </section>

      {headers.length > 0 && (
        <section aria-labelledby="columns" className="mb-6">
          <h2 id="columns" className="mb-2 text-sm font-semibold text-text-primary">
            Suggested column mapping
          </h2>
          <ul className="flex flex-col gap-1.5">
            {headers.map((header, index) => {
              const role = Object.entries(suggested).find(
                ([, colIndex]) => colIndex === index,
              )?.[0];
              return (
                <li
                  key={`${header}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm"
                >
                  <span className="truncate text-text-primary">
                    {header || `Column ${index + 1}`}
                  </span>
                  <span className="text-text-muted">
                    {role ? (FIELD_LABELS[role] ?? role) : "Not mapped"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {preview.length > 0 && (
        <section aria-labelledby="preview" className="mb-6">
          <h2 id="preview" className="mb-2 text-sm font-semibold text-text-primary">
            Preview
          </h2>
          <div className="overflow-x-auto rounded-card border border-border-subtle">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-background text-text-muted">
                <tr>
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
                  return (
                    <tr key={record.id} className="border-t border-border-subtle">
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
            Map columns and import
          </span>
          <Badge>Coming soon</Badge>
        </div>
        <p className="text-sm text-text-muted">
          Column mapping, validation, duplicate review, and commit arrive in the
          next release. Your uploaded file and detected structure are saved.
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
