import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";
import { PolicyForm } from "../../../../components/PolicyForm";
import { findPolicyTemplate, type PolicyTemplate } from "../../../../lib/policy-templates";

export default async function NewCategorizationRulePage({
  searchParams,
}: PageProps<"/categories/rules/new">) {
  const params = await searchParams;
  const templateSlug = typeof params.template === "string" ? params.template : undefined;

  // "Edit before accepting" from a learned suggestion (LearnedSuggestionItem)
  // links here with ?template=learned&name=...&category=...&pattern=... -
  // an ad-hoc template built from that suggestion's specific data, since it
  // can't be one of the 5 fixed slugs below. Reuses the exact same
  // pre-fill mechanism (PolicyForm's `template` prop), just constructed
  // per-request instead of looked up from a static list.
  const template: PolicyTemplate | undefined = templateSlug === "learned"
    ? {
      slug: "learned",
      label: "Learned suggestion",
      description: "",
      defaults: {
        name: typeof params.name === "string" ? params.name : "",
        category: typeof params.category === "string" ? params.category : "",
        subcategory: typeof params.subcategory === "string" ? params.subcategory : "",
        direction: "",
        merchantPattern: typeof params.pattern === "string" ? params.pattern : "",
      },
    }
    : findPolicyTemplate(templateSlug);

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
