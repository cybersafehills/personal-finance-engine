import { notFound } from "next/navigation";
import {
  getCategorizationPolicyById,
  getCategorySuggestions,
  getMyFinancialSources,
} from "../../../../../lib/queries";
import { financialSourceOptions } from "../../../../../lib/financial-source-options";
import { PageHeader } from "../../../../../components/PageHeader";
import { PolicyForm } from "../../../../../components/PolicyForm";

export const dynamic = "force-dynamic";

export default async function EditCategorizationRulePage({
  params,
}: PageProps<"/categories/rules/[id]/edit">) {
  const { id } = await params;
  const [policy, sources, categorySuggestions] = await Promise.all([
    getCategorizationPolicyById(id),
    getMyFinancialSources(),
    getCategorySuggestions(),
  ]);

  if (!policy) {
    notFound();
  }

  return (
    <div>
      <PageHeader
        title="Edit rule"
        subtitle="Categorize matching transactions automatically"
        backHref="/categories/rules"
      />
      <PolicyForm
        mode="edit"
        policy={policy}
        sources={financialSourceOptions(sources)}
        categorySuggestions={categorySuggestions}
      />
    </div>
  );
}
