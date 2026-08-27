import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { NetworkOverview } from "../../../../components/directory/public/NetworkOverview";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isPaymentNetworksEnabled } from "../../../../lib/pay/gate";
import { messages } from "../../../../lib/ussd/messages";
import { getPublicNetworkBySlug, findRoutes } from "../../../../lib/directory/public-queries";

export const dynamic = "force-dynamic";

const STANDARD_INTEROP_FLOWS = [
  "account_to_wallet",
  "wallet_to_account",
  "account_to_account",
  "wallet_to_wallet",
  "merchant_payment",
];

export default async function PaymentNetworkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  if (!isPaymentNetworksEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Payment network" backHref="/pay/ussd" backLabel={messages().ussd.title} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const { slug } = await params;
  const network = await getPublicNetworkBySlug(slug);
  if (!network) notFound();

  const routes = await findRoutes({ networkSlug: slug });
  const routeFlows = new Set<string>();
  for (const r of routes) for (const f of r.flow_types) routeFlows.add(f);
  const supportedFlows =
    network.entity_type === "interoperable_network"
      ? Array.from(new Set([...STANDARD_INTEROP_FLOWS, ...routeFlows]))
      : Array.from(routeFlows);

  return (
    <div>
      <PageHeader
        title={network.canonical_name}
        subtitle={messages().network.overviewHeading}
        backHref="/pay/ussd"
        backLabel={messages().ussd.title}
        action={
          <Link
            href={`/pay/networks/${slug}/routes`}
            className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            {messages().network.findRoute}
          </Link>
        }
      />
      <NetworkOverview network={network} supportedFlows={supportedFlows} />
    </div>
  );
}
