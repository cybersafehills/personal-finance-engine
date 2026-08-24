import Link from "next/link";
import { getTransactions } from "../../lib/queries";
import { TransactionList } from "../../components/TransactionList";
import { PageHeader } from "../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: PageProps<"/transactions">) {
  const { category } = await searchParams;
  const categoryFilter = typeof category === "string" ? category : undefined;

  const transactions = await getTransactions({
    limit: 100,
    category: categoryFilter,
  });

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
      <TransactionList
        transactions={transactions}
        emptyTitle={
          categoryFilter
            ? `No transactions in ${categoryFilter}`
            : "No transactions yet"
        }
      />
    </div>
  );
}
