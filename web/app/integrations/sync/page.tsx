import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { ExportScheduleForm } from "../../../components/ExportScheduleForm";
import { ExportScheduleList } from "../../../components/ExportScheduleList";
import { DestinationManager } from "../../../components/DestinationManager";
import { formatDateTime } from "../../../lib/format";
import {
  getActiveWorkspaceId,
  getCanonicalConnectorInstallations,
} from "../../../lib/queries";
import {
  isCloudStorageEnabled,
  isDestinationsEnabled,
  isSyncEnabled,
  isWorkbooksEnabled,
} from "../../../lib/integrations/gate";
import { CLOUD_STORAGE_PROVIDER_META } from "../../../lib/integrations/destinations/cloud-storage/contract";
import { configuredCloudProviders } from "../../../lib/integrations/destinations/cloud-storage/registry";
import { WorkbookManager } from "../../../components/WorkbookManager";
import {
  listConnectedWorkbooks,
  listExportSchedules,
  listIntegrationDestinations,
  listOpenConflicts,
  listSyncRuns,
} from "../../../lib/integrations/queries";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isSyncEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Sync & Automation"
          backHref="/integrations"
          backLabel="Integrations"
        />
        <EmptyState
          title="Sync & Automation isn’t enabled"
          description="Scheduled exports and connector sync controls are still in preview."
        />
      </div>
    );
  }

  const destinationsEnabled = isDestinationsEnabled(workspaceId);
  const configured = isCloudStorageEnabled(workspaceId)
    ? new Set(configuredCloudProviders())
    : new Set<string>();
  const cloudProviders = isCloudStorageEnabled(workspaceId)
    ? Object.values(CLOUD_STORAGE_PROVIDER_META).map((m) => ({
      key: m.key,
      label: m.label,
      configured: configured.has(m.key),
    }))
    : [];
  const workbooksEnabled = isWorkbooksEnabled(workspaceId);
  const [schedules, installations, destinations, workbooks, syncRuns, conflicts] =
    await Promise.all([
      listExportSchedules(),
      getCanonicalConnectorInstallations(),
      destinationsEnabled ? listIntegrationDestinations() : Promise.resolve([]),
      workbooksEnabled ? listConnectedWorkbooks() : Promise.resolve([]),
      destinationsEnabled || workbooksEnabled
        ? listSyncRuns(15)
        : Promise.resolve([]),
      workbooksEnabled ? listOpenConflicts() : Promise.resolve([]),
    ]);

  return (
    <div>
      <PageHeader
        title="Sync & Automation"
        subtitle="Connector sync health and scheduled exports."
        backHref="/integrations"
        backLabel="Integrations"
      />

      <section aria-labelledby="connectors" className="mb-8">
        <h2 id="connectors" className="mb-2 text-sm font-semibold text-text-primary">
          Connector sync
        </h2>
        {installations.length === 0 ? (
          <p className="text-sm text-text-muted">
            No connectors installed.{" "}
            <Link href="/integrations/connections" className="font-medium text-accent hover:underline">
              Manage connections
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {installations.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text-primary">
                    {i.displayName}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {i.lastSuccessAt
                      ? `Last sync ${formatDateTime(i.lastSuccessAt)}`
                      : "No successful sync yet"}
                  </span>
                </span>
                <Badge
                  variant={i.status === "healthy" ? "positive" : i.status === "error" ? "attention" : "neutral"}
                >
                  {i.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {destinationsEnabled && (
        <section aria-labelledby="destinations" className="mb-8">
          <h2 id="destinations" className="mb-2 text-sm font-semibold text-text-primary">
            Destinations
          </h2>
          <p className="mb-3 text-sm text-text-muted">
            Where an export or scheduled delivery is sent. A webhook receives a
            signed JSON envelope with a short-lived download link; “download
            only” keeps the file in the export history.
          </p>
          <DestinationManager
            destinations={destinations}
            cloudProviders={cloudProviders}
          />
        </section>
      )}

      <section aria-labelledby="schedules">
        <h2 id="schedules" className="mb-2 text-sm font-semibold text-text-primary">
          Scheduled exports
        </h2>
        <p className="mb-3 text-sm text-text-muted">
          A schedule generates an export on its cadence. It appears in the
          export history to download; a failed run notifies you and retries
          on the next cycle.
        </p>
        <div className="mb-4">
          <ExportScheduleList schedules={schedules} />
        </div>
        <ExportScheduleForm
          destinations={destinations.map((d) => ({ id: d.id, name: d.name }))}
        />
      </section>

      {conflicts.length > 0 && (
        <Link
          href="/integrations/sync/conflicts"
          className="mt-6 block rounded-card border border-attention/30 bg-attention-bg p-4 text-sm font-medium text-attention"
        >
          {conflicts.length} sync {conflicts.length === 1 ? "conflict" : "conflicts"} need a decision →
        </Link>
      )}

      {workbooksEnabled && (
        <section aria-labelledby="workbooks" className="mt-8">
          <h2 id="workbooks" className="mb-2 text-sm font-semibold text-text-primary">
            Connected workbooks
          </h2>
          <p className="mb-3 text-sm text-text-muted">
            Keep an external spreadsheet in step with your ledger. OneLedger stays
            authoritative — inbound changes go to review, never straight to the
            ledger.
          </p>
          <WorkbookManager workbooks={workbooks} />
        </section>
      )}

      {syncRuns.length > 0 && (
        <section aria-labelledby="runs" className="mt-8">
          <h2 id="runs" className="mb-2 text-sm font-semibold text-text-primary">
            Recent sync runs
          </h2>
          <ul className="flex flex-col gap-2">
            {syncRuns.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/integrations/sync/runs/${r.id}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-3 text-sm transition-colors hover:bg-background"
                >
                  <span className="text-text-secondary">
                    {r.trigger} · {r.direction} · {formatDateTime(r.createdAt)}
                  </span>
                  <Badge
                    variant={r.status === "succeeded"
                      ? "positive"
                      : r.status === "failed"
                      ? "attention"
                      : "neutral"}
                  >
                    {r.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
