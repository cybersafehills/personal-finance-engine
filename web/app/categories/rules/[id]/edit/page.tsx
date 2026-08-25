import { notFound } from "next/navigation";
import { getCategorizationPolicyById } from "../../../../../lib/queries";
import { PageHeader } from "../../../../../components/PageHeader";
import { PolicyForm } from "../../../../../components/PolicyForm";

export const dynamic = "force-dynamic";

export default async function EditCategorizationRulePage({
  params,
}: PageProps<"/categories/rules/[id]/edit">) {
  const { id } = await params;
  const policy = await getCategorizationPolicyById(id);

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
      <PolicyForm mode="edit" policy={policy} />
    </div>
  );
}
