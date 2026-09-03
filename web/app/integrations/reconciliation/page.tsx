import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { StatTile } from "../../../components/StatTile";
import { formatDateTime } from "../../../lib/format";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isReconciliationCenterEnabled } from "../../../lib/integrations/gate";
import { getReconciliationCenterSummary } from "../../../lib/integrations/reconciliation/queries";
import type {
  ReconSection,
  ReconSeverity,
} from "../../../lib/integrations/reconciliation/summary";

export const dynamic = "force-dynamic";

const SEVERITY_BADGE: Record<
  ReconSeverity,
  { variant: "attention" | "neutral" | "positive"; label: string }
> = {
  critical: { variant: "attention", label: "Needs attention" },
  attention: { variant: "neutral", label: "Review" },
  clear: { variant: "positive", label: "Clear" },
};

export default async function ReconciliationCenterPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isReconciliationCenterEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Reconciliation"
          backHref="/integrations"
          backLabel="Integrations"
        />
        <EmptyState
          title="Reconciliation Center isn’t enabled for this Space"
          description="Ask an administrator to turn it on, or check back soon."
        />
      </div>
    );
  }

  const summary = await getReconciliationCenterSummary();

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Every open money-matching decision in one place. Each item opens on the screen that resolves it."
        backHref="/integrations"
        backLabel="Integrations"
      />

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile
          label="Open items"
          value={String(summary.totalOpen)}
          hint={summary.totalOpen === 1 ? "decision" : "decisions"}
        />
        <StatTile label="Urgent" value={String(summary.totalCritical)} />
      </div>

      {summary.allClear && (
        <div className="mb-6 rounded-card border border-border-subtle bg-surface p-4">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">
              Nothing to reconcile
            </span>
            <Badge variant="positive">Clear</Badge>
          </div>
          <p className="text-sm text-text-muted">
            No balance drift, unmatched payments, possible duplicates, or sync
            conflicts are waiting on a decision right now.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {summary.sections.map((section) => (
          <li key={section.key}>
            <SectionRow section={section} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionRow({ section }: { section: ReconSection }) {
  const badge = SEVERITY_BADGE[section.severity];

  const body = (
    <>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {section.title}
          </span>
          {!section.available ? (
            <Badge>Coming soon</Badge>
          ) : (
            <Badge variant={badge.variant}>
              {section.openCount > 0
                ? `${section.openCount} ${badge.label.toLowerCase()}`
                : badge.label}
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block text-sm text-text-muted">
          {section.description}
        </span>
        {section.available && section.oldestActionableAt && (
          <span className="mt-0.5 block text-xs text-text-muted">
            Oldest since {formatDateTime(section.oldestActionableAt)}
          </span>
        )}
      </span>
      {section.available && (
        <span aria-hidden="true" className="shrink-0 text-text-muted">
          →
        </span>
      )}
    </>
  );

  if (!section.available) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4 opacity-80">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={section.href}
      className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
    >
      {body}
    </Link>
  );
}
