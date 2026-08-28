import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { Badge } from "../../../../components/Badge";
import { NetworkOverview } from "../../../../components/directory/public/NetworkOverview";
import { RouteFinder } from "../../../../components/directory/public/RouteFinder";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import {
  isPaymentNetworksEnabled,
  isDirectorySuggestionsEnabled,
} from "../../../../lib/pay/gate";
import { messages } from "../../../../lib/ussd/messages";
import {
  getPublicNetworkBySlug,
  getRouteFinderOptions,
  findRoutes,
  FLOW_LABELS,
} from "../../../../lib/directory/public-queries";
import { trackDirectoryEvent } from "../../../../lib/directory/analytics";

export const dynamic = "force-dynamic";

const t = messages().network;

const STANDARD_INTEROP_FLOWS = [
  "account_to_wallet",
  "wallet_to_account",
  "account_to_account",
  "wallet_to_wallet",
  "merchant_payment",
];

export default async function PaymentNetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const flow = typeof sp.flow === "string" ? sp.flow : undefined;
  const channel = typeof sp.channel === "string" ? sp.channel : undefined;

  const [options, routes] = await Promise.all([
    getRouteFinderOptions(slug),
    findRoutes({ networkSlug: slug, sourceProviderId: from, flowType: flow, channel }),
  ]);

  if (routes.length === 0) {
    trackDirectoryEvent("route_finder_no_result", {
      network: slug,
      has_source: Boolean(from),
      flow,
      channel,
    });
  }

  const routeFlows = new Set<string>();
  for (const r of routes) for (const f of r.flow_types) routeFlows.add(f);
  const supportedFlows =
    network.entity_type === "interoperable_network"
      ? Array.from(new Set([...STANDARD_INTEROP_FLOWS, ...routeFlows]))
      : Array.from(routeFlows);

  const filtered = Boolean(from || flow || channel);

  return (
    <div>
      <PageHeader
        title={network.canonical_name}
        backHref="/pay/ussd"
        backLabel={messages().ussd.title}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {network.verified_at == null ? (
          <Badge variant="attention">{messages().ussd.notVerifiedBadge}</Badge>
        ) : (
          <Badge variant="positive">{messages().ussd.verifiedBadge}</Badge>
        )}
        <span className="text-sm text-text-secondary">
          {network.entity_type.replace(/_/g, " ")}
        </span>
      </div>

      <p className="mb-5 text-sm text-text-secondary">{t.summary}</p>

      <RouteFinder sources={options.sources} flows={options.destinationTypes} />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">{t.resultsHeading}</h2>
        {routes.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <EmptyState
              title={filtered ? t.noRoutesTitle : t.noRoutesTitle}
              description={t.noRoutesBody}
            />
            {isDirectorySuggestionsEnabled(workspaceId) ? (
              <Link
                href={`/pay/suggest?type=new_route&network=${slug}`}
                className="min-h-11 rounded-control border border-border-subtle bg-surface px-4 py-2.5 text-sm font-medium text-text-primary"
              >
                {t.suggestRoute}
              </Link>
            ) : (
              <p className="text-center text-xs text-text-muted">{t.suggestRouteComingSoon}</p>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {routes.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/pay/networks/${slug}/routes/${r.id}`}
                  className="flex items-center gap-3 rounded-control border border-border-subtle bg-surface px-4 py-3 transition-colors hover:border-accent hover:bg-background active:bg-background"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-text-primary">
                        {r.display_name_en}
                      </span>
                      {r.verified_at == null ? (
                        <Badge variant="attention">{messages().ussd.notVerifiedBadge}</Badge>
                      ) : (
                        <Badge variant="positive">{messages().ussd.verifiedBadge}</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-muted">
                      <span>{r.provider_name}</span>
                      <span aria-hidden="true">·</span>
                      <span>{r.channel.replace(/_/g, " ")}</span>
                      {r.flow_types.slice(0, 2).map((f) => (
                        <span key={f}>· {FLOW_LABELS[f] ?? f.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  </div>
                  <span aria-hidden="true" className="shrink-0 text-lg font-medium text-accent">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-control border border-border-subtle">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-text-primary [&::-webkit-details-marker]:hidden">
          {t.aboutToggle}
        </summary>
        <div className="border-t border-border-subtle px-4 py-4">
          <NetworkOverview network={network} supportedFlows={supportedFlows} />
        </div>
      </details>
    </div>
  );
}
