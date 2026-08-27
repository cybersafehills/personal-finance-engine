import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/PageHeader";
import { PaymentNetworkForm } from "../../../../../components/directory/PaymentNetworkForm";
import { DirectoryStateControls } from "../../../../../components/directory/DirectoryStateControls";
import { NetworkExtrasPanel } from "../../../../../components/directory/NetworkExtrasPanel";
import { EvidencePanel } from "../../../../../components/directory/EvidencePanel";
import { VersionHistory } from "../../../../../components/directory/VersionHistory";
import { getDirectoryAccess } from "../../../../../lib/pay/directory-perms";
import {
  getPaymentNetworkForEdit,
  listReferenceEntities,
} from "../../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function EditPaymentNetworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const { id } = await params;
  const [network, ref] = await Promise.all([
    getPaymentNetworkForEdit(id),
    listReferenceEntities(),
  ]);
  if (!network) notFound();

  const canEditDraft = access.has("directory.edit_draft");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edit payment network"
        subtitle={network.canonical_name}
        backHref="/admin/directory/networks"
        backLabel="Payment Networks"
      />

      <DirectoryStateControls entity="network" id={network.id} currentState={network.state} />

      {canEditDraft ? (
        <PaymentNetworkForm
          authorities={ref.authorities}
          existing={{
            ...network,
            aliases: network.aliases.map((a) => ({ alias: a.alias, is_primary: a.is_primary })),
          }}
        />
      ) : (
        <p className="text-sm text-text-muted">
          You have read-only access. `directory.edit_draft` is required to change this record.
        </p>
      )}

      <NetworkExtrasPanel
        networkId={network.id}
        operators={network.operators}
        fees={network.fees}
        limits={network.limits}
        serviceOperators={ref.operators}
        canEdit={canEditDraft}
      />

      <EvidencePanel
        subjectType="payment_network"
        subjectId={network.id}
        evidence={network.evidence}
        sources={ref.sources}
        canManage={access.has("directory.manage_evidence")}
      />

      <VersionHistory versions={network.versions} />
    </div>
  );
}
