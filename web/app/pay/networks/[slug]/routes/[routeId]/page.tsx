import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../../components/PageHeader";
import { EmptyState } from "../../../../../../components/EmptyState";
import { RouteResultPanel } from "../../../../../../components/directory/public/RouteResultPanel";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { isPaymentNetworksEnabled } from "../../../../../../lib/pay/gate";
import { messages } from "../../../../../../lib/ussd/messages";
import { getRouteResult, getRouteFavouriteIds } from "../../../../../../lib/directory/public-queries";

export const dynamic = "force-dynamic";

export default async function RouteResultPage({
  params,
}: {
  params: Promise<{ slug: string; routeId: string }>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  if (!isPaymentNetworksEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Route" backHref="/pay/ussd" backLabel={messages().ussd.title} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const { slug, routeId } = await params;
  const [route, favIds] = await Promise.all([
    getRouteResult(slug, routeId),
    getRouteFavouriteIds(),
  ]);
  if (!route) notFound();

  return (
    <div>
      <PageHeader
        title={route.display_name_en}
        subtitle={`${route.provider_name}${route.network ? ` · ${route.network.canonical_name}` : ""}`}
        backHref={`/pay/networks/${slug}`}
        backLabel={route.network?.canonical_name ?? messages().ussd.title}
      />
      <RouteResultPanel route={route} favourited={favIds.has(route.id)} />
    </div>
  );
}
