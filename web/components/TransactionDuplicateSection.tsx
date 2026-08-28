import Link from "next/link";
import { formatDateTime } from "../lib/format";
import type { TransactionDuplicateContext } from "../lib/queries";

const SOURCE_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  manual: "Manual entry",
  statement: "Imported statement",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * Phase U PR5: the duplicate-resolution trail on a transaction's detail
 * page. Renders nothing for an ordinary (`unique`) transaction with no
 * merged children.
 */
export function TransactionDuplicateSection({
  context,
}: {
  context: TransactionDuplicateContext;
}) {
  const { dedupeState, mergedInto, mergedDuplicates } = context;

  const showFlagged = dedupeState === "possible_duplicate";
  const showMergedAway = dedupeState === "merged" && mergedInto != null;
  const showChildren = mergedDuplicates.length > 0;

  if (!showFlagged && !showMergedAway && !showChildren) {
    return null;
  }

  return (
    <section
      aria-label="Duplicates"
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        Duplicates
      </p>

      {showFlagged && (
        <p role="status" className="text-sm text-text-secondary">
          This transaction is flagged as a possible duplicate.{" "}
          <Link
            href="/transactions/review"
            className="font-medium text-accent hover:underline"
          >
            Review it
          </Link>
          .
        </p>
      )}

      {showMergedAway && mergedInto && (
        <p role="status" className="text-sm text-text-secondary">
          Merged into another transaction on{" "}
          {formatDateTime(mergedInto.occurredAt)} — it is kept as a record
          but no longer counted.{" "}
          <Link
            href={`/transactions/${mergedInto.id}`}
            className="font-medium text-accent hover:underline"
          >
            Open the kept transaction
          </Link>
          .
        </p>
      )}

      {showChildren && (
        <div>
          <p className="mb-1.5 text-sm text-text-secondary">
            {mergedDuplicates.length === 1
              ? "1 duplicate was merged into this transaction"
              : `${mergedDuplicates.length} duplicates were merged into this transaction`}
            . They stay on record but are left out of every total.
          </p>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {mergedDuplicates.map((dup) => (
              <li
                key={dup.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/transactions/${dup.id}`}
                  className="min-w-0 truncate text-accent hover:underline"
                >
                  {dup.counterparty ?? "Transaction"}
                </Link>
                <span className="shrink-0 text-xs text-text-muted">
                  {sourceLabel(dup.source)} · {formatDateTime(dup.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
