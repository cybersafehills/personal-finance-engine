import { notFound } from "next/navigation";
import { getCategorizationPolicyById } from "../../../../../lib/queries";
import { PageHeader } from "../../../../../components/PageHeader";
import { ApplyPolicyPanel } from "../../../../../components/ApplyPolicyPanel";
import { previewHistoricalMatches } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApplyPolicyToHistoryPage({
  params,
}: PageProps<"/categories/rules/[id]/apply">) {
  const { id } = await params;
  const policy = await getCategorizationPolicyById(id);

  if (!policy) {
    notFound();
  }

  const preview = await previewHistoricalMatches(id);

  return (
    <div>
      <PageHeader
        title="Apply to existing transactions"
        subtitle={`"${policy.name || policy.category}" against transactions still Uncategorized`}
      />
      <ApplyPolicyPanel policyId={id} initialPreview={preview} />
    </div>
  );
}
