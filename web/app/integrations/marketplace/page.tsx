import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { StatTile } from "../../../components/StatTile";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isMarketplaceEnabled } from "../../../lib/integrations/gate";
import {
  MARKETPLACE_STATUS_META,
  type MarketplaceEntry,
  type MarketplaceStatus,
  marketplaceByCategory,
  marketplaceStatusCounts,
} from "../../../lib/integrations/marketplace/catalog";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<
  MarketplaceStatus,
  "positive" | "accent" | "neutral"
> = {
  available: "positive",
  beta: "accent",
  coming_soon: "neutral",
};

export default async function MarketplacePage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isMarketplaceEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Marketplace"
          backHref="/integrations"
          backLabel="Integrations"
        />
        <EmptyState
          title="The integration marketplace isn’t enabled for this Space"
          description="Ask an administrator to turn it on, or check back soon."
        />
      </div>
    );
  }

  const groups = marketplaceByCategory();
  const counts = marketplaceStatusCounts();

  return (
    <div>
      <PageHeader
        title="Marketplace"
        subtitle="Everything OneLedger can connect to — what’s live today and what’s on the way."
        backHref="/integrations"
        backLabel="Integrations"
      />

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile label="Available" value={String(counts.available)} />
        <StatTile label="In beta" value={String(counts.beta)} />
        <StatTile label="Coming soon" value={String(counts.coming_soon)} />
      </div>

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`mkt-${group.category}`}>
            <h2
              id={`mkt-${group.category}`}
              className="mb-2 text-sm font-semibold text-text-primary"
            >
              {group.label}
            </h2>
            <ul className="flex flex-col gap-2">
              {group.entries.map((entry) => (
                <li key={entry.key}>
                  <EntryRow entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: MarketplaceEntry }) {
  const status = MARKETPLACE_STATUS_META[entry.status];
  const reachable = entry.configHref !== null && entry.status !== "coming_soon";

  const body = (
    <>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {entry.name}
          </span>
          <Badge variant={STATUS_BADGE[entry.status]}>{status.label}</Badge>
        </span>
        <span className="mt-0.5 block text-sm text-text-muted">
          {entry.summary}
        </span>
        <span className="mt-1 block text-xs text-text-muted">
          Docs: <code className="text-text-secondary">{entry.docHref}</code>
        </span>
      </span>
      {reachable && (
        <span aria-hidden="true" className="shrink-0 text-text-muted">
          →
        </span>
      )}
    </>
  );

  if (reachable && entry.configHref) {
    return (
      <Link
        href={entry.configHref}
        className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4 opacity-80">
      {body}
    </div>
  );
}
