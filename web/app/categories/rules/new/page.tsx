import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";
import { PolicyForm } from "../../../../components/PolicyForm";
import { findPolicyTemplate } from "../../../../lib/policy-templates";

export default async function NewCategorizationRulePage({
  searchParams,
}: PageProps<"/categories/rules/new">) {
  const { template: templateSlug } = await searchParams;
  const template = findPolicyTemplate(
    typeof templateSlug === "string" ? templateSlug : undefined,
  );

  return (
    <div>
      <PageHeader
        title="New rule"
        subtitle="Categorize matching transactions automatically"
        action={
          <Link href="/categories/rules/templates" className="text-sm font-medium text-accent">
            Start from a template
          </Link>
        }
      />
      <PolicyForm mode="create" template={template} />
    </div>
  );
}
