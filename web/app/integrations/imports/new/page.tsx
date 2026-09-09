import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { ImportUploadForm } from "../../../../components/ImportUploadForm";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../lib/integrations/gate";
import {
  type ImportTargetObject,
  isImportTargetObject,
} from "../../../../lib/integrations/model";

export const dynamic = "force-dynamic";

const COPY: Record<
  ImportTargetObject,
  { title: string; subtitle: string }
> = {
  transaction: {
    title: "Import data",
    subtitle:
      "Upload a bank statement, spreadsheet, or export. Nothing enters your ledger until you review it.",
  },
  expense: {
    title: "Import an expense register",
    subtitle:
      "Every row imports as money out, and a category is required. You’ll map columns and review before anything enters your ledger.",
  },
  income: {
    title: "Import an income register",
    subtitle:
      "Every row imports as money in, and a category is required. You’ll map columns and review before anything enters your ledger.",
  },
};

export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  const rawTarget = (await searchParams).target;
  const target: ImportTargetObject =
    typeof rawTarget === "string" && isImportTargetObject(rawTarget)
      ? rawTarget
      : "transaction";
  const copy = COPY[target];

  return (
    <div>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        backHref="/integrations/imports"
        backLabel="Imports"
      />
      <ImportUploadForm targetObject={target} />

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
