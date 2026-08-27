import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/PageHeader";
import { EmptyState } from "../../../../../components/EmptyState";
import { Badge } from "../../../../../components/Badge";
import { RouteFinder } from "../../../../../components/directory/public/RouteFinder";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { isUssdDirectoryEnabled } from "../../../../../lib/pay/gate";
import { messages } from "../../../../../lib/ussd/messages";
import {
  getPublicNetworkBySlug,
  getRouteFinderOptions,
  findRoutes,
  FLOW_LABELS,
} from "../../../../../lib/directory/public-queries";

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
  if (!isUssdDirectoryEnabled(workspaceId)) {
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
          <div className="flex flex-col gap-3">
            <EmptyState title={t.noRoutesTitle} description={t.noRoutesBody} />
            <p className="text-center text-xs text-text-muted">{t.suggestRouteComingSoon}</p>
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
