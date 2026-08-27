import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/PageHeader";
import { AccessRouteForm } from "../../../../../components/directory/AccessRouteForm";
import { getDirectoryAccess } from "../../../../../lib/pay/directory-perms";
import { listAccessRoutes, listReferenceEntities } from "../../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function NewAccessRoutePage() {
  const access = await getDirectoryAccess();
  if (!access.has("directory.create")) notFound();

  const [ref, routes] = await Promise.all([listReferenceEntities(), listAccessRoutes()]);

  return (
    <div>
      <PageHeader
        title="New access route"
        backHref="/admin/directory/routes"
        backLabel="Access Routes"
      />
      <AccessRouteForm
        providers={ref.providers.map((p) => ({ id: p.id, display_name: p.display_name }))}
        networks={ref.networks.map((n) => ({ id: n.id, canonical_name: n.canonical_name }))}
        serviceCodes={ref.serviceCodes}
        routes={routes.map((r) => ({ id: r.id, slug: r.slug, display_name_en: r.display_name_en }))}
      />
    </div>
  );
}
