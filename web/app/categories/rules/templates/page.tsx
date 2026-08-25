import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";
import { POLICY_TEMPLATES } from "../../../../lib/policy-templates";

export default function PolicyTemplatesPage() {
  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle="Pick a starting point - nothing is created until you review and save the form"
      />
      <div className="flex flex-col gap-3">
        {POLICY_TEMPLATES.map((template) => (
          <Link
            key={template.slug}
            href={`/categories/rules/new?template=${template.slug}`}
            className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4 hover:bg-background"
          >
            <p className="text-sm font-medium text-text-primary">{template.label}</p>
            <p className="text-sm text-text-muted">{template.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
