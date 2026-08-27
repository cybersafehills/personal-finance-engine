import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/PageHeader";
import { PaymentNetworkForm } from "../../../../../components/directory/PaymentNetworkForm";
import { getDirectoryAccess } from "../../../../../lib/pay/directory-perms";
import { listReferenceEntities } from "../../../../../lib/directory/admin-queries";

export const dynamic = "force-dynamic";

export default async function NewPaymentNetworkPage() {
  const access = await getDirectoryAccess();
  if (!access.has("directory.create")) notFound();

  const ref = await listReferenceEntities();

  return (
    <div>
      <PageHeader
        title="New payment network"
        backHref="/admin/directory/networks"
        backLabel="Payment Networks"
      />
      <PaymentNetworkForm authorities={ref.authorities} />
    </div>
  );
}
