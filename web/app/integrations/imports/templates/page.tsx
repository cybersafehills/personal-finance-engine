import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../lib/integrations/gate";
import {
  REGISTER_TEMPLATES,
  registerTemplateHeaders,
} from "../../../../lib/integrations/register-templates";

export const dynamic = "force-dynamic";

export default async function ImportTemplatesPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isImportStudioEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Starter templates"
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
        title="Starter templates"
        subtitle="Download a ready-made spreadsheet, fill in your rows, and upload it back. OneLedger recognises the columns automatically."
        backHref="/integrations/imports"
        backLabel="Imports"
      />

      <ul className="flex flex-col gap-3">
        {REGISTER_TEMPLATES.map((template) => (
          <li
            key={template.key}
            className="rounded-card border border-border-subtle bg-surface p-4"
          >
            <p className="text-sm font-medium text-text-primary">
              {template.name}
            </p>
            <p className="mt-0.5 text-sm text-text-muted">{template.summary}</p>
            <p className="mt-1 text-xs text-text-muted">
              Imports as {template.creates}.
            </p>
            <p className="mt-2 break-words text-xs text-text-muted">
              <span className="font-medium text-text-secondary">Columns:</span>{" "}
              {registerTemplateHeaders(template).join(" · ")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`/api/integrations/imports/templates/${template.key}?format=xlsx`}
                className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
              >
                Download Excel
              </a>
              <a
                href={`/api/integrations/imports/templates/${template.key}?format=csv`}
                className="inline-flex min-h-11 items-center rounded-control border border-border-subtle bg-background px-4 text-sm font-medium text-text-primary"
              >
                Download CSV
              </a>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-text-muted">
        Filled one in?{" "}
        <Link
          href="/integrations/imports/new"
          className="font-medium text-accent hover:underline"
        >
          Upload it here
        </Link>
        . An Invoice Register template arrives with invoice import.
      </p>
    </div>
  );
}
