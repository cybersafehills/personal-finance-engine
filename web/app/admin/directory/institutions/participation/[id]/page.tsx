import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../../components/PageHeader";
import { ParticipationForm } from "../../../../../../components/directory/ParticipationForm";
import { DirectoryStateControls } from "../../../../../../components/directory/DirectoryStateControls";
import { EvidencePanel } from "../../../../../../components/directory/EvidencePanel";
import { VersionHistory } from "../../../../../../components/directory/VersionHistory";
import { getDirectoryAccess } from "../../../../../../lib/pay/directory-perms";
import {
  getParticipationForEdit,
  listReferenceEntities,
} from "../../../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function EditParticipationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const { id } = await params;
  const [participation, ref] = await Promise.all([
    getParticipationForEdit(id),
    listReferenceEntities(),
  ]);
  if (!participation) notFound();

  const provider = participation.provider as { display_name?: string } | null;
  const network = participation.network as { canonical_name?: string } | null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edit participation"
        subtitle={`${provider?.display_name ?? "?"} → ${network?.canonical_name ?? "?"}`}
        backHref="/admin/directory/institutions"
        backLabel="Institutions & Providers"
      />

      <DirectoryStateControls
        entity="participation"
        id={id}
        currentState={participation.state as string}
      />

      {access.has("directory.edit_draft") ? (
        <ParticipationForm
          providers={ref.providers.map((p) => ({ id: p.id, display_name: p.display_name }))}
          networks={ref.networks.map((n) => ({ id: n.id, canonical_name: n.canonical_name }))}
          existing={participation as Record<string, unknown> & { id: string }}
        />
      ) : (
        <p className="text-sm text-text-muted">
          Read-only. `directory.edit_draft` is required to change this record.
        </p>
      )}

      <EvidencePanel
        subjectType="institution_participation"
        subjectId={id}
        evidence={participation.evidence}
        sources={ref.sources}
        canManage={access.has("directory.manage_evidence")}
      />

      <VersionHistory versions={participation.versions} />
    </div>
  );
}
