import { TransactionItem } from "./TransactionItem";
import { EmptyState } from "./EmptyState";
import { dateGroupLabel } from "../lib/format";
import type { TransactionRow } from "../lib/queries";

/** Groups already-chronologically-sorted transactions into Today /
 *  Yesterday / "August 18" sections - purely a presentation grouping over
 *  existing occurred_at values, no new query or backend structure. */
export function TransactionList({
  transactions,
  emptyTitle = "No transactions yet",
}: {
  transactions: TransactionRow[];
  emptyTitle?: string;
}) {
  if (transactions.length === 0) {
    return <EmptyState title={emptyTitle} />;
  }

  const groups: { label: string; items: TransactionRow[] }[] = [];

  for (const transaction of transactions) {
    const label = dateGroupLabel(transaction.occurred_at);
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(transaction);
    } else {
      groups.push({ label, items: [transaction] });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {group.label}
          </h2>
          <div className="rounded-card border border-border-subtle bg-surface p-1.5">
            <div className="flex flex-col divide-y divide-border-subtle">
              {group.items.map((transaction) => (
                <TransactionItem key={transaction.id} transaction={transaction} />
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
