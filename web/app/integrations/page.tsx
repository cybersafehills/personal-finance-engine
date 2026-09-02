import Link from "next/link";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { Badge } from "../../components/Badge";
import { StatTile } from "../../components/StatTile";
import {
  getActiveWorkspaceId,
  getCanonicalConnectorInstallations,
  getIngestionConnections,
} from "../../lib/queries";
import {
  isExportCenterEnabled,
  isImportStudioEnabled,
  isIntegrationsEnabled,
} from "../../lib/integrations/gate";
import { getIntegrationActivity } from "../../lib/integrations/activity";
import { formatDateTime } from "../../lib/format";

export const dynamic = "force-dynamic";

// The categories OneLedger's connector abstraction is being built toward.
// Nothing here is presented as connected or usable - each is explicitly
// "coming later" until a real adapter, its tests, and its onboarding
// exist (master prompt: never make a non-functional integration look
// connected).
const AVAILABLE_CATEGORIES = [
  {
    name: "Spreadsheets",
    description:
      "Connected Google Sheets and Excel workbooks that stay in sync with your ledger.",
  },
  {
    name: "Accounting",
    description:
      "Hand off to QuickBooks, Xero, Zoho Books, or Odoo without re-keying.",
  },
  {
    name: "Cloud storage",
    description:
      "Deliver scheduled exports to Google Drive, OneDrive, or Dropbox folders.",
  },
  {
    name: "Developer",
    description: "API access and webhooks for building your own integrations.",
  },
] as const;

type ConnectedSummary = {
  total: number;
  needsAttention: number;
  items: { id: string; name: string; detail: string; healthy: boolean }[];
};

/**
 * Truthful "what is actually connected" summary. Prefers the canonical
 * connector installations (Stage D); falls back to the legacy
 * ingestion_connections projection when no canonical rows exist yet, so
 * the count matches what /integrations/connections renders.
 */
async function getConnectedSummary(): Promise<ConnectedSummary> {
  const installations = await getCanonicalConnectorInstallations();
  if (installations.length > 0) {
    const visible = installations.filter((i) => i.status !== "revoked");
    return {
      total: visible.length,
      needsAttention: visible.filter(
        (i) => i.status === "error" || i.status === "stale",
      ).length,
      items: visible.map((i) => ({
        id: i.id,
        name: i.displayName,
        detail: i.status,
        healthy: i.status === "healthy",
      })),
    };
  }

  const connections = await getIngestionConnections();
  return {
    total: connections.length,
    // The legacy ingestion_connections projection has no health/error
    // state - active vs paused vs revoked only. "Needs attention" health
    // rollups arrive with the canonical connector model.
    needsAttention: 0,
    items: connections.map((c) => ({
      id: c.id,
      name: c.label,
      detail: `${c.provider} · ${c.status}`,
      healthy: c.status === "active",
    })),
  };
}

export default async function IntegrationsPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isIntegrationsEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Integrations" />
        <EmptyState
          title="Integrations isn’t enabled for this Space"
          description="Ask an administrator to turn it on, or check back soon."
        />
      </div>
    );
  }

  const [connected, activity] = await Promise.all([
    getConnectedSummary(),
    getIntegrationActivity(5),
  ]);
  const importEnabled = isImportStudioEnabled(workspaceId);
  const exportEnabled = isExportCenterEnabled(workspaceId);

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Bring financial data into OneLedger, keep it clean, and send it back out."
        backHref="/"
        backLabel="Home"
      />

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile
          label="Connected"
          value={String(connected.total)}
          hint={connected.total === 1 ? "integration" : "integrations"}
        />
        <StatTile
          label="Needs attention"
          value={String(connected.needsAttention)}
        />
      </div>

      <section aria-labelledby="integrations-connected" className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2
            id="integrations-connected"
            className="text-sm font-semibold text-text-primary"
          >
            Connected
          </h2>
          <Link
            href="/integrations/connections"
            className="text-sm font-medium text-accent hover:underline"
          >
            Manage
          </Link>
        </div>

        {connected.items.length === 0 ? (
          <EmptyState
            title="Nothing connected yet"
            description="Connect a device or import a file to start bringing financial data into OneLedger."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {connected.items.map((item) => (
              <li key={item.id}>
                <Link
                  href="/integrations/connections"
                  className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text-primary">
                      {item.name}
                    </span>
                    <span className="block truncate text-sm text-text-muted">
                      {item.detail}
                    </span>
                  </span>
                  <Badge variant={item.healthy ? "positive" : "attention"}>
                    {item.healthy ? "Healthy" : "Check"}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {activity.total > 0 && (
        <section aria-labelledby="integrations-activity" className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h2
              id="integrations-activity"
              className="text-sm font-semibold text-text-primary"
            >
              Recent activity
            </h2>
            <Link
              href="/integrations/activity"
              className="text-sm font-medium text-accent hover:underline"
            >
              View all
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {activity.items.map((item) => {
              const row = (
                <>
                  <span className="min-w-0">
                    <span className="block text-sm text-text-primary">
                      {item.summary}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {formatDateTime(item.at)}
                    </span>
                  </span>
                  {item.severity !== "info" && (
                    <Badge
                      variant={item.severity === "error" ? "attention" : "neutral"}
                    >
                      {item.severity === "error" ? "Error" : "Warning"}
                    </Badge>
                  )}
                </>
              );
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
                >
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="flex flex-1 items-center justify-between gap-3"
                    >
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="integrations-data" className="mb-8">
        <h2
          id="integrations-data"
          className="mb-2 text-sm font-semibold text-text-primary"
        >
          Move data
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <DataCard
            href={importEnabled ? "/integrations/imports" : null}
            title="Import Studio"
            body="Upload a CSV or Excel file, map its columns, review duplicates, and import into your ledger."
          />
          <DataCard
            href={exportEnabled ? "/integrations/exports" : null}
            title="Export Center"
            body="Export transactions, income, and expenses as a structured Excel workbook or CSV."
            comingSoon={!exportEnabled}
          />
        </div>
      </section>

      <section aria-labelledby="integrations-available">
        <h2
          id="integrations-available"
          className="mb-2 text-sm font-semibold text-text-primary"
        >
          Available later
        </h2>
        <ul className="flex flex-col gap-2">
          {AVAILABLE_CATEGORIES.map((category) => (
            <li
              key={category.name}
              className="rounded-card border border-border-subtle bg-surface p-4"
            >
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {category.name}
                </span>
                <Badge>Coming later</Badge>
              </div>
              <p className="text-sm text-text-muted">{category.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DataCard({
  href,
  title,
  body,
  comingSoon = false,
}: {
  href: string | null;
  title: string;
  body: string;
  comingSoon?: boolean;
}) {
  const inner = (
    <>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">{title}</span>
        {href ? (
          <span aria-hidden="true" className="text-text-muted">
            →
          </span>
        ) : (
          comingSoon && <Badge>Coming soon</Badge>
        )}
      </div>
      <p className="text-sm text-text-muted">{body}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="rounded-card border border-border-subtle bg-surface p-4">
      {inner}
    </div>
  );
}
