import Link from "next/link";
import {
  getAccounts,
  getLifetimeFlowTotals,
  getReviewQueueCount,
  getTransactions,
} from "../../lib/queries";
import { TransactionList } from "../../components/TransactionList";
import { TransactionSearchBar } from "../../components/TransactionSearchBar";
import { LifetimeFlowBadge } from "../../components/LifetimeFlowBadge";
import { PageHeader } from "../../components/PageHeader";

export const dynamic = "force-dynamic";

function parseAmount(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export default async function TransactionsPage({
  searchParams,
}: PageProps<"/transactions">) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  const categoryFilter = str(sp.category);
  const q = str(sp.q);
  const direction = ((): "in" | "out" | "neutral" | undefined => {
    const d = str(sp.direction);
    return d === "in" || d === "out" || d === "neutral" ? d : undefined;
  })();
  const currency = str(sp.currency);
  const sourceId = str(sp.account);
  const amountMin = parseAmount(sp.min);
  const amountMax = parseAmount(sp.max);

  const [transactions, reviewQueueCount, accounts, lifetimeFlow] = await Promise
    .all([
      getTransactions({
        limit: 100,
        category: categoryFilter,
        q,
        direction,
        currency,
        sourceId,
        amountMin,
        amountMax,
      }),
      getReviewQueueCount(),
      getAccounts(),
      getLifetimeFlowTotals(),
    ]);

  const accountOptions = accounts
    .filter((a) => a.financial_source_id)
    .map((a) => ({ sourceId: a.financial_source_id as string, label: a.name }));
  const currencies = Array.from(new Set(accounts.map((a) => a.currency))).sort();

  const hasSearch = Boolean(
    q || direction || currency || sourceId ||
      amountMin !== undefined || amountMax !== undefined,
  );

  return (
    <div>
      <PageHeader
        title={categoryFilter ?? "Transactions"}
        action={
          <div className="flex items-center gap-3">
            {categoryFilter && (
              <Link
                href="/transactions"
                className="rounded px-2 py-1 text-sm font-medium text-text-secondary hover:text-text-primary"
              >
                Clear filter
              </Link>
            )}
            <Link
              href="/transactions/review"
              className="text-sm font-medium text-accent hover:underline"
            >
              Review queue{reviewQueueCount > 0 ? ` (${reviewQueueCount})` : ""}
            </Link>
            <Link
              href="/transactions/transfers"
              className="text-sm font-medium text-accent hover:underline"
            >
              Transfers
            </Link>
            <Link
              href="/transactions/new"
              className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
            >
              Add transaction
            </Link>
          </div>
        }
      />

      <LifetimeFlowBadge totals={lifetimeFlow} />

      <TransactionSearchBar accounts={accountOptions} currencies={currencies} />

      {hasSearch && (
        <p className="mb-3 text-sm text-text-muted">
          {transactions.length === 100
            ? "Showing the first 100 matches"
            : `${transactions.length} match${transactions.length === 1 ? "" : "es"}`}
        </p>
      )}

      <TransactionList
        transactions={transactions}
        emptyTitle={
          hasSearch
            ? "No transactions match your search"
            : categoryFilter
              ? `No transactions in ${categoryFilter}`
              : "No transactions yet"
        }
      />
    </div>
  );
}
