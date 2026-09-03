import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { ConflictResolver } from "../../../../components/ConflictResolver";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isWorkbooksEnabled } from "../../../../lib/integrations/gate";
import { listOpenConflicts } from "../../../../lib/integrations/queries";

export const dynamic = "force-dynamic";

export default async function ConflictsPage() {
  const workspaceId = await getActiveWorkspaceId();
  if (!isWorkbooksEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Sync conflicts"
          backHref="/integrations/sync"
          backLabel="Sync & Automation"
        />
        <EmptyState title="Conflict review isn’t enabled for this Space" />
      </div>
    );
  }

  const conflicts = await listOpenConflicts();

  return (
    <div>
      <PageHeader
        title="Sync conflicts"
        subtitle="Differences between OneLedger and a connected workbook. OneLedger stays authoritative until you decide."
        backHref="/integrations/sync"
        backLabel="Sync & Automation"
      />
      {conflicts.length === 0 ? (
        <EmptyState
          title="No open conflicts"
          description="When a connected workbook disagrees with your ledger, the differences show up here for review."
        />
      ) : (
        <ConflictResolver conflicts={conflicts} />
      )}
    </div>
  );
}
