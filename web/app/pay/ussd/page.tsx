import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { DirectoryControls } from "../../../components/ussd/DirectoryControls";
import { ServiceCodeRow } from "../../../components/ussd/ServiceCodeRow";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isUssdDirectoryEnabled } from "../../../lib/pay/gate";
import { messages } from "../../../lib/ussd/messages";
import {
  getActiveProviders,
  getFavouriteCodeIds,
  getFavourites,
  getRecentServices,
  getServiceDirectory,
} from "../../../lib/ussd/queries";

export const dynamic = "force-dynamic";

const t = messages().ussd;

export default async function UssdDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  if (!isUssdDirectoryEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title={t.title} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const sp = await searchParams;
  const query = typeof sp.q === "string" ? sp.q : undefined;
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const providerSlug = typeof sp.provider === "string" ? sp.provider : undefined;
  const filtered = Boolean(query || category || providerSlug);

  const [codes, providers, favouriteIds, favourites, recent] = await Promise.all([
    getServiceDirectory({ query, category, providerSlug }),
    getActiveProviders(),
    getFavouriteCodeIds(),
    getFavourites(),
    getRecentServices(6),
  ]);

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} backHref="/" backLabel="Home" />

      <DirectoryControls providers={providers} />

      {!filtered && favourites.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-semibold text-text-secondary">{t.favourites}</h2>
          <ul>
            {favourites.map((code) => (
              <ServiceCodeRow key={code.id} code={code} favourited />
            ))}
          </ul>
        </section>
      )}

      {!filtered && recent.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-semibold text-text-secondary">{t.recent}</h2>
          <ul>
            {recent.map((code) => (
              <ServiceCodeRow
                key={code.id}
                code={code}
                favourited={favouriteIds.has(code.id)}
              />
            ))}
          </ul>
        </section>
      )}

      <section>
        {!filtered && (favourites.length > 0 || recent.length > 0) && (
          <h2 className="mb-1 text-sm font-semibold text-text-secondary">All services</h2>
        )}
        {codes.length === 0 ? (
          <EmptyState
            title={filtered ? t.noResultsTitle : t.emptyTitle}
            description={filtered ? t.noResultsBody : t.emptyBody}
          />
        ) : (
          <ul>
            {codes.map((code) => (
              <ServiceCodeRow
                key={code.id}
                code={code}
                favourited={favouriteIds.has(code.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
