import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/PageHeader";
import { AccessRouteForm } from "../../../../../components/directory/AccessRouteForm";
import { DirectoryStateControls } from "../../../../../components/directory/DirectoryStateControls";
import { EvidencePanel } from "../../../../../components/directory/EvidencePanel";
import { VersionHistory } from "../../../../../components/directory/VersionHistory";
import { getDirectoryAccess } from "../../../../../lib/pay/directory-perms";
import { getAccessRouteForEdit, listAccessRoutes, listReferenceEntities } from "../../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function EditAccessRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const { id } = await params;
  const [route, ref, routes] = await Promise.all([
    getAccessRouteForEdit(id),
    listReferenceEntities(),
    listAccessRoutes(),
  ]);
  if (!route) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edit access route"
        subtitle={route.display_name_en as string}
        backHref="/admin/directory/routes"
        backLabel="Access Routes"
      />

      <DirectoryStateControls entity="route" id={id} currentState={route.state as string} />

      {access.has("directory.edit_draft") ? (
        <AccessRouteForm
          providers={ref.providers.map((p) => ({ id: p.id, display_name: p.display_name }))}
          networks={ref.networks.map((n) => ({ id: n.id, canonical_name: n.canonical_name }))}
          serviceCodes={ref.serviceCodes}
          routes={routes.map((r) => ({ id: r.id, slug: r.slug, display_name_en: r.display_name_en }))}
          existing={route as Record<string, unknown> & { id: string }}
        />
      ) : (
        <p className="text-sm text-text-muted">
          Read-only. `directory.edit_draft` is required to change this record.
        </p>
      )}

      <EvidencePanel
        subjectType="access_route"
        subjectId={id}
        evidence={route.evidence}
        sources={ref.sources}
        canManage={access.has("directory.manage_evidence")}
      />

      <VersionHistory versions={route.versions} />
    </div>
  );
}
