import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "../../../components/Badge";
import { PageHeader } from "../../../components/PageHeader";
import { InsightAmount } from "../../../components/insights/InsightAmount";
import { PersonManager } from "../../../components/people/PersonManager";
import { formatDateTime } from "../../../lib/format";
import { getActiveWorkspace } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import {
  confidenceLabel,
  confidenceNote,
  formatMinor,
  isCounterpartiesEnabledFor,
  isPersonKind,
  isUuid,
  KIND_LABEL,
  PAGE_SIZE,
  pageWindow,
} from "../../../lib/counterparties/directory";
import { loadCounterpartyDetail } from "../../../lib/counterparties/directory-data";

export const dynamic = "force-dynamic";

const KIND_VARIANT = { person: "accent", merchant: "positive", unknown: "neutral", self: "attention" } as const;

export default async function PersonPage({ params, searchParams }: PageProps<"/people/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const workspace = await getActiveWorkspace();
  if (!workspace || !isCounterpartiesEnabledFor(process.env, workspace.id)) notFound();

  const sp = await searchParams;
  const rawPage = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10_000 ? rawPage : 1;

  const supabase = await supabaseSession();
  const res = await loadCounterpartyDetail(supabase, workspace.id, id, pageWindow(page));
  if (res.kind === "not_found") notFound();
  // Combined into someone else: send them to who it became.
  if (res.kind === "merged") redirect(`/people/${res.into}`);

  const { counterparty: p, mergedFrom, totalTransactions, transactions } = res.detail;
  const kind = isPersonKind(p.kind) ? p.kind : "unknown";
  const note = confidenceNote(p.confidence);
  const lastPage = Math.max(1, Math.ceil(totalTransactions / PAGE_SIZE));
  const canWrite = workspace.role !== "viewer";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={p.display_name}
        subtitle={`${KIND_LABEL[kind]} · ${confidenceLabel(p.confidence)}`}
        backHref="/people"
        backLabel="People and merchants"
        action={<Badge variant={KIND_VARIANT[kind]}>{KIND_LABEL[kind]}</Badge>}
      />

      {note ? <p className="text-sm text-text-secondary">{note}</p> : null}

      <section aria-labelledby="totals" className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
        <h2 id="totals" className="text-sm font-semibold text-text-primary">Totals</h2>
        {p.currencies.length === 0
          ? <p className="text-sm text-text-secondary">No money has moved with them yet.</p>
          : (
            <dl className="flex flex-col gap-3">
              {p.currencies.map((c) => {
                const net = BigInt(c.net_minor);
                return (
                  <div key={c.currency} className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-text-muted">You sent</dt>
                      <dd className="font-medium"><InsightAmount text={formatMinor(c.sent_minor, c.currency)} /></dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">You received</dt>
                      <dd className="font-medium"><InsightAmount text={formatMinor(c.received_minor, c.currency)} /></dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">Net</dt>
                      <dd className="font-medium">
                        <InsightAmount text={`${net > 0n ? "+" : ""}${formatMinor(net, c.currency)}`} />
                      </dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          )}
        {p.first_at && p.last_at
          ? (
            <p className="text-xs text-text-muted">
              {p.txn_count} {p.txn_count === 1 ? "transaction" : "transactions"} · first {formatDateTime(p.first_at)} · latest{" "}
              {formatDateTime(p.last_at)}
            </p>
          )
          : null}
      </section>

      {mergedFrom.length > 0
        ? (
          <section aria-labelledby="merged" className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4">
            <h2 id="merged" className="text-sm font-semibold text-text-primary">Combined into this one</h2>
            <ul className="text-sm text-text-secondary">
              {mergedFrom.map((m) => <li key={m.id}>{m.display_name}</li>)}
            </ul>
          </section>
        )
        : null}

      <PersonManager
        key={`${p.id}:${p.display_name}:${p.kind}`}
        personId={p.id}
        name={p.display_name}
        kind={kind}
        canWrite={canWrite}
        transactions={transactions.map((t) => ({
          id: t.id,
          when: formatDateTime(t.occurred_at),
          amount: `${BigInt(t.amount_minor) > 0n ? "+" : ""}${formatMinor(t.amount_minor, t.currency)}`,
          title: t.category ?? t.transaction_type.replace(/_/g, " "),
          status: t.status,
        }))}
        totalTransactions={totalTransactions}
        page={page}
        lastPage={lastPage}
      />

      {lastPage > 1
        ? (
          <nav aria-label="Transaction pages" className="flex items-center justify-between gap-3">
            {page > 1
              ? (
                <Link href={`/people/${p.id}?page=${page - 1}`} rel="prev" className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary">
                  Newer
                </Link>
              )
              : <span />}
            {page < lastPage
              ? (
                <Link href={`/people/${p.id}?page=${page + 1}`} rel="next" className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary">
                  Older
                </Link>
              )
              : <span />}
          </nav>
        )
        : null}
    </div>
  );
}
