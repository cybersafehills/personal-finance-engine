import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { WorkbookAnalyzeForm } from "../../../../components/WorkbookAnalyzeForm";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../lib/integrations/gate";

export const dynamic = "force-dynamic";

// "Connect existing business records" (master prompt §41): upload a
// workbook you already keep, see which sheets look like transaction
// tables, and stage the ones you choose — each as its own import that
// runs the normal review-before-commit flow.

export default async function AnalyzeWorkbookPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isImportStudioEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Analyze a workbook"
          backHref="/integrations/imports"
          backLabel="Imports"
        />
        <EmptyState title="The Import Studio isn’t enabled for this Space" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Analyze a workbook"
        subtitle="Upload an existing spreadsheet. OneLedger checks each sheet and you choose which to bring in — nothing enters your ledger until you review it."
        backHref="/integrations/imports"
        backLabel="Imports"
      />
      <WorkbookAnalyzeForm />
    </div>
  );
}
