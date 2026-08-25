import { getReviewQueueTransactions } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ReviewQueueItem } from "../../../components/ReviewQueueItem";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const transactions = await getReviewQueueTransactions();

  return (
    <div>
      <PageHeader
        title="Review queue"
        subtitle="Transactions categorized with less than full confidence, or where two rules disagreed"
      />

      {transactions.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="Provisional, suggested, and conflicting categorizations will appear here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {transactions.map((t) => <ReviewQueueItem key={t.id} transaction={t} />)}
        </div>
      )}
    </div>
  );
}
