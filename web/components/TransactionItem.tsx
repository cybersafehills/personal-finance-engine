import Link from "next/link";
import { MoneyAmount } from "./MoneyAmount";
import { Badge } from "./Badge";
import { formatDateTime, formatTime } from "../lib/format";
import { displayName } from "../lib/display-name";
import type { TransactionRow } from "../lib/queries";

export function TransactionItem({
  transaction,
  showDate = false,
  masked = false,
}: {
  transaction: TransactionRow;
  /** Show a short date+time ("Aug 20, 14:03") instead of just a time - use
   *  on ungrouped lists (Home). Grouped lists (Transactions) already show
   *  the date as a section header, so pass false there. */
  showDate?: boolean;
  /** Full financial privacy mode - masks the amount for the Home dashboard
   *  preview list only; the full Transactions page is a deliberate, opt-in
   *  destination and is never masked (master prompt §6.3). */
  masked?: boolean;
}) {
  const signedAmount =
    transaction.direction === "in"
      ? transaction.amount_rwf
      : transaction.direction === "out"
        ? -transaction.amount_rwf
        : 0;

  const isFailed = transaction.status !== "success";
  const needsReview = ["provisional", "suggested", "conflict"].includes(
    transaction.category_decision_status,
  );

  return (
    <Link
      href={`/transactions/${transaction.id}`}
      className="flex min-h-14 items-center justify-between gap-3 rounded-control px-3 py-2.5 transition-colors hover:bg-background focus-visible:bg-background"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">
          {displayName(transaction)}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
          <span>
            {showDate
              ? formatDateTime(transaction.occurred_at)
              : formatTime(transaction.occurred_at)}
          </span>
          {transaction.category ? (
            <span className="truncate">· {transaction.category}</span>
          ) : (
            <Badge variant="attention">Uncategorized</Badge>
          )}
          {isFailed && <Badge variant="attention">Failed</Badge>}
          {needsReview && <Badge variant="attention">Review</Badge>}
        </p>
      </div>
      <MoneyAmount
        amountRwf={isFailed ? 0 : signedAmount}
        size="sm"
        masked={masked}
      />
    </Link>
  );
}
