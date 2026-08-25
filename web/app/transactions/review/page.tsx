import { getReviewQueueTransactions } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ReviewQueueList } from "../../../components/ReviewQueueList";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const transactions = await getReviewQueueTransactions();

  return (
    <div>
      <PageHeader
        title="Review queue"
        subtitle="Transactions categorized with less than full confidence, or where two rules disagreed"
        backHref="/transactions"
      />

      {transactions.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="Provisional, suggested, and conflicting categorizations will appear here."
        />
      ) : (
        <ReviewQueueList transactions={transactions} />
      )}
    </div>
  );
}
