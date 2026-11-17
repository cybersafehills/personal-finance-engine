import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SortTransactionsBanner } from "../../components/people/SortTransactionsBanner";
import { getActiveWorkspace } from "../../lib/queries";
import { supabaseSession } from "../../lib/supabase-session-server";
import {
  confidenceNote,
  directoryHref,
  flowText,
  isCounterpartiesEnabledFor,
  isPersonKind,
  KIND_FILTERS,
  KIND_LABEL,
  PAGE_SIZE,
  pageWindow,
  parseDirectoryQuery,
} from "../../lib/counterparties/directory";
import { loadCounterpartyList } from "../../lib/counterparties/directory-data";

export const dynamic = "force-dynamic";

const KIND_VARIANT = { person: "accent", merchant: "positive", unknown: "neutral" } as const;

export default async function PeoplePage({ searchParams }: PageProps<"/people">) {
  const workspace = await getActiveWorkspace();
  // Dark unless the flag covers this Space: indistinguishable from no such page.
  if (!workspace || !isCounterpartiesEnabledFor(process.env, workspace.id)) notFound();

  const query = parseDirectoryQuery(await searchParams);
  const supabase = await supabaseSession();
  const list = await loadCounterpartyList(supabase, workspace.id, {
    q: query.q,
    kind: query.kind,
    ...pageWindow(query.page),
  });
  const canWrite = workspace.role !== "viewer";
  const filtered = query.q !== null || query.kind !== null;
  const lastPage = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="People and merchants"
        subtitle="Who you pay and who pays you, grouped from your transactions."
      />

      {list.unresolvedTransactions > 0 && !filtered
        ? <SortTransactionsBanner count={list.unresolvedTransactions} canWrite={canWrite} />
        : null}

      <form action="/people" method="get" role="search" className="flex flex-col gap-3">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="people-q">Search by name</label>
          <input
            id="people-q"
            name="q"
            type="search"
            defaultValue={query.q ?? ""}
            maxLength={80}
            placeholder="Search by name"
            className="min-h-11 w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
          />
          {query.kind ? <input type="hidden" name="kind" value={query.kind} /> : null}
          <button
            type="submit"
            className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            Search
          </button>
        </div>
        <nav aria-label="Filter by type" className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((f) => {
            const active = f.value === query.kind;
            return (
              <Link
                key={f.label}
                href={directoryHref({ q: query.q, kind: f.value, page: 1 })}
                aria-current={active ? "true" : undefined}
                className={`min-h-9 rounded-control border px-3 py-1.5 text-sm font-medium ${
                  active
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border-subtle bg-surface text-text-secondary hover:border-accent"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </form>

      {list.counterparties.length === 0
        ? (
          <EmptyState
            title={filtered ? "Nobody matches that" : "No people or merchants yet"}
            description={filtered
              ? "Try a different name, or clear the filter."
              : "They appear here once your transactions have been sorted."}
            action={filtered
              ? (
                <Link href="/people" className="text-sm font-medium text-accent hover:underline">
                  Clear search and filter
                </Link>
              )
              : undefined}
          />
        )
        : (
          <>
            <p className="text-xs text-text-muted" aria-live="polite">
              {list.total} {list.total === 1 ? "match" : "matches"}
              {lastPage > 1 ? ` · page ${query.page} of ${lastPage}` : ""}
            </p>
            <ul className="flex flex-col gap-2">
              {list.counterparties.map((c) => {
                const kind = isPersonKind(c.kind) ? c.kind : "unknown";
                const note = confidenceNote(c.confidence);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/people/${c.id}`}
                      className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-3 hover:border-accent"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-text-primary">{c.display_name}</span>
                        <Badge variant={KIND_VARIANT[kind]}>{KIND_LABEL[kind]}</Badge>
                      </span>
                      {c.currencies.map((cur) => (
                        <span key={cur.currency} className="text-xs text-text-secondary">
                          {flowText(cur)}
                        </span>
                      ))}
                      <span className="text-xs text-text-muted">
                        {c.txn_count} {c.txn_count === 1 ? "transaction" : "transactions"}
                        {note ? ` · ${note}` : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {lastPage > 1
              ? (
                <nav aria-label="Pages" className="flex items-center justify-between gap-3">
                  {query.page > 1
                    ? (
                      <Link
                        href={directoryHref({ ...query, page: query.page - 1 })}
                        rel="prev"
                        className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary"
                      >
                        Previous
                      </Link>
                    )
                    : <span />}
                  {query.page < lastPage
                    ? (
                      <Link
                        href={directoryHref({ ...query, page: query.page + 1 })}
                        rel="next"
                        className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary"
                      >
                        Next
                      </Link>
                    )
                    : <span />}
                </nav>
              )
              : null}
          </>
        )}
    </div>
  );
}
