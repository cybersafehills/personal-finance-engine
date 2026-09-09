import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { ImportUploadForm } from "../../../../components/ImportUploadForm";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../lib/integrations/gate";

export const dynamic = "force-dynamic";

export default async function NewImportPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isImportStudioEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Import data"
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
        title="Import data"
        subtitle="Upload a bank statement, spreadsheet, or export. Nothing enters your ledger until you review it."
        backHref="/integrations/imports"
        backLabel="Imports"
      />
      <ImportUploadForm />

      <div className="mt-4 flex flex-col gap-1.5 text-sm text-text-muted">
        <p>
          Multi-sheet workbook?{" "}
          <Link
            href="/integrations/imports/analyze"
            className="font-medium text-accent hover:underline"
          >
            Analyze it
          </Link>{" "}
          to import several sheets at once.
        </p>
        <p>
          No file ready?{" "}
          <Link
            href="/integrations/imports/templates"
            className="font-medium text-accent hover:underline"
          >
            Download a starter template
          </Link>{" "}
          for daily sales, expenses, or a cashbook.
        </p>
      </div>
    </div>
  );
}
