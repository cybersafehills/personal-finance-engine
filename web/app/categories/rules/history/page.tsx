import { getBulkCategorizationRuns } from "../../../../lib/queries";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { BulkRunItem } from "../../../../components/BulkRunItem";

export const dynamic = "force-dynamic";

export default async function BulkCategorizationHistoryPage() {
  const runs = await getBulkCategorizationRuns();

  return (
    <div>
      <PageHeader
        title="Bulk categorization history"
        subtitle="Every historical-apply run, oldest and newest - revert any of them, not just the one you just ran"
        backHref="/categories/rules"
      />

      {runs.length === 0 ? (
        <EmptyState
          title="No bulk runs yet"
          description="Applying a rule to existing transactions from a rule's page will show up here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map((run) => <BulkRunItem key={run.bulkOperationId} run={run} />)}
        </div>
      )}
    </div>
  );
}
