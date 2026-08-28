import Link from "next/link";
import {
  getNeedsAttributionTransactions,
  getReviewQueueTransactions,
  getSpaceDuplicateReview,
} from "../../../lib/queries";
import { formatDateTime, formatRwf } from "../../../lib/format";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ReviewQueueList } from "../../../components/ReviewQueueList";
import { DuplicateReviewList } from "../../../components/DuplicateReviewList";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const [transactions, needsAttribution, duplicateClusters] = await Promise.all([
    getReviewQueueTransactions(),
    getNeedsAttributionTransactions(),
    getSpaceDuplicateReview(),
  ]);

  const nothingToDo =
    transactions.length === 0 &&
    needsAttribution.length === 0 &&
    duplicateClusters.length === 0;

  return (
    <div>
      <PageHeader
        title="Review queue"
        subtitle="Categorizations made with less than full confidence, and household transactions still waiting on an attribution"
        backHref="/transactions"
      />

      {nothingToDo ? (
        <EmptyState
          title="Nothing to review"
          description="Provisional, suggested, and conflicting categorizations — and unattributed household transactions — will appear here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {duplicateClusters.length > 0 && (
            <section aria-label="Possible duplicates">
              <h2 className="mb-2 text-sm font-medium text-text-primary">
                Possible duplicates ({duplicateClusters.length})
              </h2>
              <DuplicateReviewList clusters={duplicateClusters} />
            </section>
          )}

          {needsAttribution.length > 0 && (
            <section aria-label="Needs attribution">
              <h2 className="mb-2 text-sm font-medium text-text-primary">
                Needs attribution ({needsAttribution.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {needsAttribution.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/transactions/${t.id}`}
                      className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-text-primary">
                          {t.counterpartyName ?? "Transaction"}
                        </span>
                        <span className="block text-xs text-text-muted">
                          {t.workspaceName ? `${t.workspaceName} · ` : ""}
                          {formatDateTime(t.occurredAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium text-text-primary">
                        {t.direction === "out" ? "−" : ""}
                        {formatRwf(t.amountRwf)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {transactions.length > 0 && (
            <section aria-label="Category review">
              {(needsAttribution.length > 0 ||
                duplicateClusters.length > 0) && (
                <h2 className="mb-2 text-sm font-medium text-text-primary">
                  Category review ({transactions.length})
                </h2>
              )}
              <ReviewQueueList transactions={transactions} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
