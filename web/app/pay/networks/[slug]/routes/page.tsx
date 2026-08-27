import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/PageHeader";
import { EmptyState } from "../../../../../components/EmptyState";
import { Badge } from "../../../../../components/Badge";
import { RouteFinder } from "../../../../../components/directory/public/RouteFinder";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import {
  isPaymentNetworksEnabled,
  isDirectorySuggestionsEnabled,
} from "../../../../../lib/pay/gate";
import { messages } from "../../../../../lib/ussd/messages";
import {
  getPublicNetworkBySlug,
  getRouteFinderOptions,
  findRoutes,
  FLOW_LABELS,
} from "../../../../../lib/directory/public-queries";
import { trackDirectoryEvent } from "../../../../../lib/directory/analytics";

export const dynamic = "force-dynamic";

const t = messages().network;

export default async function NetworkRouteFinderPage({
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
        <PageHeader title={t.routeFinderTitle} backHref="/pay/ussd" backLabel={messages().ussd.title} />
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

  return (
    <div>
      <PageHeader
        title={t.routeFinderTitle}
        subtitle={network.canonical_name}
        backHref={`/pay/networks/${slug}`}
        backLabel={network.canonical_name}
      />

      <RouteFinder sources={options.sources} flows={options.destinationTypes} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">{t.resultsHeading}</h2>
        {routes.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <EmptyState title={t.noRoutesTitle} description={t.noRoutesBody} />
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
          <ul>
            {routes.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 border-b border-border-subtle py-3 last:border-b-0"
              >
                <Link
                  href={`/pay/networks/${slug}/routes/${r.id}`}
                  className="min-w-0 flex-1"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-text-primary">{r.display_name_en}</span>
                    {r.verified_at == null ? (
                      <Badge variant="attention">{messages().ussd.notVerifiedBadge}</Badge>
                    ) : (
                      <Badge variant="positive">{messages().ussd.verifiedBadge}</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                    <span>{r.provider_name}</span>
                    <span aria-hidden="true">·</span>
                    <span>{r.channel.replace(/_/g, " ")}</span>
                    {r.flow_types.slice(0, 2).map((f) => (
                      <span key={f}>· {FLOW_LABELS[f] ?? f.replace(/_/g, " ")}</span>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
