import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { ExportConfigForm } from "../../../components/ExportConfigForm";
import { formatDateTime } from "../../../lib/format";
import { getAccounts, getActiveWorkspaceId } from "../../../lib/queries";
import {
  isDestinationsEnabled,
  isExportCenterEnabled,
} from "../../../lib/integrations/gate";
import {
  listExportJobs,
  listExportTemplates,
  listIntegrationDestinations,
} from "../../../lib/integrations/queries";
import type { ExportJobStatus } from "../../../lib/integrations/model";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ExportJobStatus, string> = {
  queued: "Queued",
  processing: "Preparing…",
  completed: "Ready",
  failed: "Failed",
};

function variant(s: ExportJobStatus): "neutral" | "attention" | "positive" {
  if (s === "failed") return "attention";
  if (s === "completed") return "positive";
  return "neutral";
}

export default async function ExportsPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isExportCenterEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Exports" backHref="/integrations" backLabel="Integrations" />
        <EmptyState title="The Export Center isn’t enabled for this Space" />
      </div>
    );
  }

  const [jobs, templates, accounts, destinations] = await Promise.all([
    listExportJobs(),
    listExportTemplates(),
    getAccounts(),
    isDestinationsEnabled(workspaceId)
      ? listIntegrationDestinations()
      : Promise.resolve([]),
  ]);
  const activeAccounts = accounts.filter((a) => a.is_active);

  return (
    <div>
      <PageHeader
        title="Exports"
        subtitle="Download your transactions as a structured Excel workbook or CSV."
        backHref="/integrations"
        backLabel="Integrations"
      />

      <ExportConfigForm
        accounts={activeAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
        }))}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          config: t.config,
        }))}
        destinations={destinations.map((d) => ({ id: d.id, name: d.name }))}
      />

      <h2 className="mb-2 mt-8 text-sm font-semibold text-text-primary">History</h2>
      {jobs.length === 0 ? (
        <EmptyState
          title="No exports yet"
          description="Generate one above — it will appear here to download."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  {job.format.toUpperCase()} export
                  {typeof job.rowCount === "number"
                    ? ` · ${job.rowCount} rows`
                    : ""}
                </span>
                <span className="block text-xs text-text-muted">
                  {formatDateTime(job.requestedAt)}
                  {job.status === "failed" &&
                    (job.error as { message?: string })?.message
                    ? ` · ${(job.error as { message?: string }).message}`
                    : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={variant(job.status)}>
                  {STATUS_LABEL[job.status]}
                </Badge>
                {job.status === "completed" && job.storagePath && (
                  <a
                    href={`/api/integrations/exports/${job.id}`}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Download
                  </a>
                )}
                {job.status === "completed" && !job.storagePath && (
                  <span className="text-xs text-text-muted">Expired</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
