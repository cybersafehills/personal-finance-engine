import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { ServiceCodeAdminForm } from "../../../../components/ussd/ServiceCodeAdminForm";
import { AdminStateControls } from "../../../../components/ussd/AdminStateControls";
import { isPlatformAdmin } from "../../../../lib/pay/admin";
import {
  getProvidersForAdmin,
  getServiceCodeForEdit,
  getVersionHistory,
} from "../../../../lib/ussd/admin-queries";
import { messages } from "../../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

const t = messages().admin;

export default async function EditServiceCodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isPlatformAdmin())) notFound();

  const { id } = await params;
  const [code, providers, versions] = await Promise.all([
    getServiceCodeForEdit(id),
    getProvidersForAdmin(),
    getVersionHistory(id),
  ]);

  if (!code) notFound();

  return (
    <div>
      <PageHeader
        title={t.editCode}
        subtitle={code.display_name_en}
        backHref="/admin/ussd"
        backLabel={t.title}
      />

      <div className="mb-5">
        <AdminStateControls serviceCodeId={code.id} currentState={code.state} />
      </div>

      <ServiceCodeAdminForm providers={providers} existing={code} />

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">{t.versionHistory}</h2>
        <ul className="text-sm">
          {versions.map((v) => (
            <li
              key={v.version}
              className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
            >
              <span className="font-medium text-text-primary">v{v.version}</span>
              <span className="flex-1 text-text-secondary">{v.change_reason ?? "—"}</span>
              <span className="text-xs text-text-muted">
                {new Date(v.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
