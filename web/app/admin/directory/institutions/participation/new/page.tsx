import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../../components/PageHeader";
import { ParticipationForm } from "../../../../../../components/directory/ParticipationForm";
import { getDirectoryAccess } from "../../../../../../lib/pay/directory-perms";
import { listReferenceEntities } from "../../../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function NewParticipationPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; network?: string }>;
}) {
  const access = await getDirectoryAccess();
  if (!access.has("directory.create")) notFound();

  const [ref, sp] = await Promise.all([listReferenceEntities(), searchParams]);

  return (
    <div>
      <PageHeader
        title="New institution participation"
        backHref="/admin/directory/institutions"
        backLabel="Institutions & Providers"
      />
      <ParticipationForm
        providers={ref.providers.map((p) => ({ id: p.id, display_name: p.display_name }))}
        networks={ref.networks.map((n) => ({ id: n.id, canonical_name: n.canonical_name }))}
        lockTargets={{ providerId: sp.provider, networkId: sp.network }}
      />
    </div>
  );
}
