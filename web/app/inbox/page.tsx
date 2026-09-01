import Link from "next/link";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { formatDateTime } from "../../lib/format";
import { getFinancialInbox } from "../../lib/financial-inbox";
import type {
  FinancialInboxItem,
  FinancialInboxKind,
  FinancialInboxPriority,
} from "../../lib/financial-inbox-model";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<FinancialInboxKind, string> = {
  connector_health: "Connection",
  reconciliation_conflict: "Reconciliation",
  duplicate_candidate: "Duplicate",
  needs_attribution: "Attribution",
  category_review: "Category",
  rule_suggestion: "Rule suggestion",
  budget_alert: "Budget",
};

const PRIORITY_LABELS: Record<FinancialInboxPriority, string> = {
  critical: "Resolve first",
  high: "Next up",
  normal: "When ready",
};

const PRIORITY_STYLES: Record<FinancialInboxPriority, string> = {
  critical: "border-attention/30 bg-attention-bg text-attention",
  high: "border-accent/20 bg-background text-accent",
  normal: "border-border-subtle bg-background text-text-secondary",
};

function InboxItemRow({ item }: { item: FinancialInboxItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="block rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLES[item.priority]}`}>
                {KIND_LABELS[item.kind]}
              </span>
              {item.affectedCount > 1 && (
                <span className="text-xs text-text-muted">
                  {item.affectedCount} records
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-text-primary">{item.title}</p>
            <p className="mt-0.5 text-sm text-text-muted">{item.description}</p>
            {item.actionableSince && (
              <p className="mt-2 text-xs text-text-muted">
                Waiting since {formatDateTime(item.actionableSince)}
              </p>
            )}
          </div>
          <span aria-hidden="true" className="mt-1 shrink-0 text-text-muted">→</span>
        </div>
      </Link>
    </li>
  );
}

export default async function FinancialInboxPage() {
  const inbox = await getFinancialInbox();

  return (
    <div>
      <PageHeader
        title="Financial Inbox"
        subtitle="One prioritized workflow for decisions and problems across your ledger"
        backHref="/"
        backLabel="Home"
      />

      {inbox.total === 0 ? (
        <EmptyState
          title="You’re all caught up"
          description="Review decisions, duplicate candidates, reconciliation conflicts, connector issues, and other actions will appear here."
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-2" aria-label="Inbox summary">
            <div className="rounded-card border border-border-subtle bg-surface p-3">
              <p className="text-xl font-semibold text-text-primary">{inbox.total}</p>
              <p className="text-xs text-text-muted">Open</p>
            </div>
            <div className="rounded-card border border-border-subtle bg-surface p-3">
              <p className="text-xl font-semibold text-attention">{inbox.criticalCount}</p>
              <p className="text-xs text-text-muted">Resolve first</p>
            </div>
            <div className="rounded-card border border-border-subtle bg-surface p-3">
              <p className="text-xl font-semibold text-text-primary">{inbox.highCount}</p>
              <p className="text-xs text-text-muted">Next up</p>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {(["critical", "high", "normal"] as const).map((priority) => {
              const items = inbox.items.filter((item) => item.priority === priority);
              if (items.length === 0) return null;
              return (
                <section key={priority} aria-labelledby={`inbox-${priority}`}>
                  <h2 id={`inbox-${priority}`} className="mb-2 text-sm font-semibold text-text-primary">
                    {PRIORITY_LABELS[priority]} ({items.length})
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((item) => <InboxItemRow key={item.id} item={item} />)}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
