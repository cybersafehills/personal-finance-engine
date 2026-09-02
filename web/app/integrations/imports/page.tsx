import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { formatDateTime } from "../../../lib/format";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isImportStudioEnabled } from "../../../lib/integrations/gate";
import { listImportBatches } from "../../../lib/integrations/queries";
import type { ImportBatchStatus } from "../../../lib/integrations/model";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ImportBatchStatus, string> = {
  uploaded: "Uploaded",
  profiled: "Detected",
  mapped: "Mapped",
  validated: "Validated",
  previewed: "Previewed",
  committing: "Importing…",
  imported: "Imported",
  failed: "Failed",
  rolled_back: "Rolled back",
};

function statusVariant(
  status: ImportBatchStatus,
): "neutral" | "attention" | "positive" {
  if (status === "failed") return "attention";
  if (status === "imported") return "positive";
  return "neutral";
}

export default async function ImportsPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isImportStudioEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Imports"
          backHref="/integrations"
          backLabel="Integrations"
        />
        <EmptyState title="The Import Studio isn’t enabled for this Space" />
      </div>
    );
  }

  const batches = await listImportBatches();

  return (
    <div>
      <PageHeader
        title="Imports"
        subtitle="Bring transactions in from a CSV or Excel file."
        backHref="/integrations"
        backLabel="Integrations"
        action={
          <Link
            href="/integrations/imports/new"
            className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            New import
          </Link>
        }
      />

      {batches.length === 0 ? (
        <EmptyState
          title="No imports yet"
          description="Upload a bank statement or spreadsheet to get started. You’ll map its columns and review duplicates before anything enters your ledger."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {batches.map((batch) => (
            <li key={batch.id}>
              <Link
                href={`/integrations/imports/${batch.id}`}
                className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-primary">
                    {batch.originalFilename}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {batch.sourceKind.toUpperCase()} ·{" "}
                    {typeof batch.rowCounts.total === "number"
                      ? `${batch.rowCounts.total} rows · `
                      : ""}
                    {formatDateTime(batch.createdAt)}
                  </span>
                </span>
                <Badge variant={statusVariant(batch.status)}>
                  {STATUS_LABEL[batch.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
