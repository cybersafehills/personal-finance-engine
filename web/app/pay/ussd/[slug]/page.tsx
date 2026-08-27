import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { ServiceCodeDetailPanel } from "../../../../components/ussd/ServiceCodeDetailPanel";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isUssdDirectoryEnabled } from "../../../../lib/pay/gate";
import { messages } from "../../../../lib/ussd/messages";
import {
  getFavouriteCodeIds,
  getServiceCodeBySlug,
} from "../../../../lib/ussd/queries";

export const dynamic = "force-dynamic";

const t = messages().ussd;

export default async function ServiceCodePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  if (!isUssdDirectoryEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title={t.title} backHref="/pay/ussd" backLabel={t.title} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const { slug } = await params;
  const [code, favouriteIds] = await Promise.all([
    getServiceCodeBySlug(slug),
    getFavouriteCodeIds(),
  ]);

  if (!code) notFound();

  return (
    <div>
      <PageHeader
        title={code.display_name_en}
        subtitle={code.provider.display_name}
        backHref="/pay/ussd"
        backLabel={t.title}
      />
      <ServiceCodeDetailPanel
        code={code}
        favourited={favouriteIds.has(code.id)}
      />
    </div>
  );
}
