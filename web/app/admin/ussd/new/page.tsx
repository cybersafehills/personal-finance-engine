import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { ServiceCodeAdminForm } from "../../../../components/ussd/ServiceCodeAdminForm";
import { isPlatformAdmin } from "../../../../lib/pay/admin";
import { getProvidersForAdmin } from "../../../../lib/ussd/admin-queries";
import { messages } from "../../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

export default async function NewServiceCodePage() {
  if (!(await isPlatformAdmin())) notFound();
  const providers = await getProvidersForAdmin();

  return (
    <div>
      <PageHeader
        title={messages().admin.newCode}
        backHref="/admin/ussd"
        backLabel={messages().admin.title}
      />
      <ServiceCodeAdminForm providers={providers} />
    </div>
  );
}
