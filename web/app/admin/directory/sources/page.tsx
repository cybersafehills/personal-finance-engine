import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { ReferenceEntityForms } from "../../../../components/directory/ReferenceEntityForms";
import { getDirectoryAccess } from "../../../../lib/pay/directory-perms";
import { listReferenceEntities } from "../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function DirectorySourcesPage() {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const ref = await listReferenceEntities();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sources & Authorities"
        subtitle="Regulatory authorities, system operators, and verification sources"
        backHref="/admin/directory"
        backLabel="Directory Management"
      />

      <ReferenceEntityForms canCreate={access.has("directory.create")} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">Regulatory authorities</h2>
        <ul className="text-sm">
          {ref.authorities.map((a) => (
            <li key={a.id} className="border-b border-border-subtle py-2 last:border-b-0">
              <span className="font-medium text-text-primary">{a.name}</span>
              <span className="ml-2 font-mono text-xs text-text-muted">{a.slug}</span>
            </li>
          ))}
          {ref.authorities.length === 0 && <li className="py-2 text-text-muted">None.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">System operators</h2>
        <ul className="text-sm">
          {ref.operators.map((o) => (
            <li key={o.id} className="border-b border-border-subtle py-2 last:border-b-0">
              <span className="font-medium text-text-primary">{o.name}</span>
              <span className="ml-2 font-mono text-xs text-text-muted">{o.slug}</span>
            </li>
          ))}
          {ref.operators.length === 0 && <li className="py-2 text-text-muted">None.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">Verification sources</h2>
        <ul className="text-sm">
          {ref.sources.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="font-medium text-text-primary">{s.organization}</span>
                {s.title ? <span className="ml-2 text-text-secondary">{s.title}</span> : null}
              </span>
              <Badge variant="neutral">{s.classification.replace(/_/g, " ")}</Badge>
            </li>
          ))}
          {ref.sources.length === 0 && <li className="py-2 text-text-muted">None.</li>}
        </ul>
      </section>
    </div>
  );
}
