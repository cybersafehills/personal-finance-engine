import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { InsightAmount } from "../../components/insights/InsightAmount";
import { InsightsFilters } from "../../components/insights/InsightsFilters";
import { formatDateKeyLabel, formatZonedDateTime } from "../../lib/format";
import { zonedDateKey } from "../../lib/report-period";
import {
  getInsightsContext,
  loadInsightsDataset,
} from "../../lib/insights/insights-page-data";
import {
  compareOverviews,
  excludedTotal,
  formatBps,
  formatMoney,
  historyCoverage,
  type HistoryCoverage,
  unassignedAccountRemainder,
} from "../../lib/insights/insights-facts";
import {
  type Comparison,
  computeOverview,
  computeTrend,
  type CurrencyOverview,
  type DrilldownFilter,
  type Granularity,
  type TrendBucket,
} from "../../lib/insights/insights-math";
import {
  autoGranularity,
  drilldownHref,
  type InsightsQuery,
  parseInsightsQuery,
  resolveWindow,
  scopeFor,
} from "../../lib/insights/insights-params";

export const dynamic = "force-dynamic";

const card = "rounded-card border border-border-subtle bg-surface p-4";
const th = "py-1.5 pr-3 text-left text-xs font-medium text-text-muted";
const thRight = "py-1.5 pl-3 text-right text-xs font-medium text-text-muted";
const link = "font-medium text-accent hover:underline";
const TOP_COUNTERPARTIES = 10;
const STALE_AFTER_DAYS = 7;

function comparisonText(
  c: Comparison,
  currency: string,
  days: number,
  coverage: HistoryCoverage,
): string {
  if (c.deltaMinor === null) return "No earlier activity to compare with";
  const span = days === 1 ? "the day before" : `the previous ${days} days`;
  const pct = c.deltaBps === null ? "" : ` (${formatBps(c.deltaBps)})`;
  const base = c.deltaMinor === 0n
    ? `Same as ${span}`
    : `${formatMoney(c.deltaMinor, currency, { signed: true })}${pct} vs ${span}`;
  return coverage === "partial" ? `${base} — earlier records are incomplete` : base;
}

function bucketLabel(key: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const label = formatDateKeyLabel(key);
  return g === "week" ? `Week of ${label}` : label;
}

function Bar({ value, max, tone }: {
  value: bigint;
  max: bigint;
  tone: "in" | "out";
}) {
  const pct = max > 0n && value > 0n ? Number((value * 100n) / max) : 0;
  return (
    <span
      aria-hidden="true"
      className={`block h-1.5 rounded-full ${
        tone === "in" ? "bg-money-positive" : "bg-text-muted"
      }`}
      style={{ width: `${Math.max(pct, value > 0n ? 2 : 0)}%` }}
    />
  );
}

function HeadlineCard({
  title,
  amount,
  tone,
  href,
  count,
  comparison,
}: {
  title: string;
  amount: string;
  tone: "positive" | "negative" | "neutral";
  href?: string;
  count?: string;
  comparison: string;
}) {
  return (
    <div className={card}>
      <h3 className="text-xs font-medium text-text-muted">{title}</h3>
      <p className="mt-1 text-2xl font-semibold">
        <InsightAmount text={amount} tone={tone} />
      </p>
      <p className="mt-1 text-xs text-text-muted">{comparison}</p>
      {href && (
        <p className="mt-2 text-sm">
          <Link href={href} className={link}>
            View {count ?? "transactions"}
          </Link>
        </p>
      )}
    </div>
  );
}

function CurrencySection({
  o,
  previous,
  coverage,
  query,
  days,
  trend,
  granularity,
  sourceLabels,
}: {
  o: CurrencyOverview;
  previous: CurrencyOverview | undefined;
  coverage: HistoryCoverage;
  query: InsightsQuery;
  days: number;
  trend: TrendBucket[];
  granularity: Granularity;
  sourceLabels: Map<string, string>;
}) {
  const cur = o.currency;
  const money = (v: bigint, signed = false) => formatMoney(v, cur, { signed });
  const href = (f: DrilldownFilter) => drilldownHref(query, f);
  const cmp = compareOverviews(o, previous, coverage);
  const rest = unassignedAccountRemainder(o);
  const hasUnassigned = rest.moneyInMinor !== 0n || rest.moneyOutMinor !== 0n;
  const trendMax = trend.reduce((m, b) => {
    const top = b.moneyInMinor > b.moneyOutMinor
      ? b.moneyInMinor
      : b.moneyOutMinor;
    return top > m ? top : m;
  }, 0n);
  const top = o.counterparties.slice(0, TOP_COUNTERPARTIES);
  const hasActivity = o.countIn + o.countOut > 0 || o.refundsMinor !== 0n;

  const notes: { key: string; text: React.ReactNode }[] = [];
  if (o.transfersExcluded.count > 0) {
    notes.push({
      key: "transfers",
      text: (
        <>
          <InsightAmount text={money(o.transfersExcluded.amountMinor)} />{" "}
          moved between your own wallets ({o.transfersExcluded.count}{" "}
          transaction{o.transfersExcluded.count === 1 ? "" : "s"}). This is
          not counted as money in or out.{" "}
          <Link href={href(o.drilldowns.transfers)} className={link}>
            View transfers
          </Link>
        </>
      ),
    });
  }
  if (o.pending.count > 0) {
    notes.push({
      key: "pending",
      text: (
        <>
          {o.pending.count} pending transaction
          {o.pending.count === 1 ? "" : "s"} (
          <InsightAmount text={money(o.pending.amountMinor)} />) not counted
          until confirmed.{" "}
          <Link href={href(o.drilldowns.pending)} className={link}>
            View pending
          </Link>
        </>
      ),
    });
  }
  if (o.cashOutMinor !== 0n) {
    notes.push({
      key: "cash",
      text: (
        <>
          Money out includes{" "}
          <InsightAmount text={money(o.cashOutMinor)} />{" "}
          withdrawn as cash. What the cash was spent on is not known.{" "}
          <Link href={href(o.drilldowns.cash_out)} className={link}>
            View withdrawals
          </Link>
        </>
      ),
    });
  }
  if (o.refundsMinor !== 0n) {
    notes.push({
      key: "refunds",
      text: (
        <>
          <InsightAmount text={money(o.refundsMinor)} />{" "}
          in refunds and reversals reduced money out; refunds are never
          counted as income.{" "}
          <Link href={href(o.drilldowns.refunds)} className={link}>
            View refunds
          </Link>
        </>
      ),
    });
  }
  if (o.failedCount > 0) {
    notes.push({
      key: "failed",
      text: `${o.failedCount} failed transaction${
        o.failedCount === 1 ? "" : "s"
      } not counted.`,
    });
  }

  return (
    <section aria-label={`${cur} insights`} className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-text-primary">{cur}</h2>

      <div className="grid gap-3 sm:grid-cols-3">
        <HeadlineCard
          title="Money in"
          amount={money(o.moneyInMinor)}
          tone="positive"
          href={o.countIn > 0 ? href(o.drilldowns.money_in) : undefined}
          count={`${o.countIn} transaction${o.countIn === 1 ? "" : "s"}`}
          comparison={comparisonText(cmp.moneyIn, cur, days, coverage)}
        />
        <HeadlineCard
          title="Money out"
          amount={money(o.moneyOutMinor)}
          tone="neutral"
          href={hasActivity ? href(o.drilldowns.money_out) : undefined}
          count="what makes this up"
          comparison={comparisonText(cmp.moneyOut, cur, days, coverage)}
        />
        <HeadlineCard
          title="Net (in minus out)"
          amount={money(o.netMinor, true)}
          tone={o.netMinor > 0n
            ? "positive"
            : o.netMinor < 0n
            ? "negative"
            : "neutral"}
          comparison={comparisonText(cmp.net, cur, days, coverage)}
        />
      </div>

      {notes.length > 0 && (
        <ul className={`${card} flex flex-col gap-2 text-sm text-text-secondary`}>
          {notes.map((n) => <li key={n.key}>{n.text}</li>)}
        </ul>
      )}

      {o.byCategory.length > 0 && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">
            Where money went
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">
                Money out by category, {cur}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Category</th>
                  <th scope="col" className={thRight}>Amount</th>
                  <th scope="col" className={thRight}>Share of money out</th>
                  <th scope="col" className={thRight}>Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {o.byCategory.map((c) => (
                  <tr key={c.category}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <Link href={href(c.drilldown)} className={link}>
                        {c.category}
                      </Link>
                      {c.amountMinor < 0n && (
                        <span className="block text-xs text-text-muted">
                          Refunds were larger than spending
                        </span>
                      )}
                    </th>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(c.amountMinor)} />
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-text-secondary">
                      {o.moneyOutMinor > 0n ? formatBps(c.percentBps) : "—"}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-text-secondary">
                      {c.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(o.byAccount.length > 0 || hasUnassigned) && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">
            By wallet
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">
                Money in and out by wallet, {cur}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Wallet</th>
                  <th scope="col" className={thRight}>Money in</th>
                  <th scope="col" className={thRight}>Money out</th>
                  <th scope="col" className={thRight}>Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {o.byAccount.map((a) => (
                  <tr key={a.accountId}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <Link
                        href={href({
                          scope: o.drilldowns.money_in.scope,
                          currency: cur,
                          kind: "account",
                          value: a.accountId,
                        })}
                        className={link}
                      >
                        {sourceLabels.get(a.accountId) ??
                          "Wallet no longer listed"}
                      </Link>
                    </th>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(a.moneyInMinor)} />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(a.moneyOutMinor)} />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(a.netMinor, true)} />
                    </td>
                  </tr>
                ))}
                {hasUnassigned && (
                  <tr>
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-text-secondary">
                      Not linked to a wallet
                    </th>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(rest.moneyInMinor)} />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(rest.moneyOutMinor)} />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount
                        text={money(
                          rest.moneyInMinor - rest.moneyOutMinor,
                          true,
                        )}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {top.length > 0 && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-text-primary">
            People and merchants
          </h3>
          <p className="mb-2 text-xs text-text-muted">
            Grouped by the name written on each transaction. Two different
            people with the same name will appear together, and one person
            with several names will appear separately.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">
                Top people and merchants by amount, {cur}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Name</th>
                  <th scope="col" className={thRight}>Sent</th>
                  <th scope="col" className={thRight}>Received</th>
                  <th scope="col" className={thRight}>Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {top.map((c) => (
                  <tr key={c.key}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-text-primary">
                      {c.displayName}
                    </th>
                    <td className="py-2 pl-3 text-right">
                      {c.sentMinor !== 0n
                        ? (
                          <Link href={href(c.drilldownSent)} className={link}>
                            <InsightAmount text={money(c.sentMinor)} />
                          </Link>
                        )
                        : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      {c.receivedMinor !== 0n
                        ? (
                          <Link
                            href={href(c.drilldownReceived)}
                            className={link}
                          >
                            <InsightAmount text={money(c.receivedMinor)} />
                          </Link>
                        )
                        : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-text-secondary">
                      {c.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.counterparties.length > top.length && (
            <p className="mt-2 text-xs text-text-muted">
              Showing the top {top.length} of {o.counterparties.length}.
            </p>
          )}
        </div>
      )}

      {trend.length > 0 && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">
            Trend by {granularity}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-sm">
              <caption className="sr-only">
                Money in, money out and net by {granularity}, {cur}. Periods
                with no counted activity are not listed.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    {granularity === "day" ? "Day" : "Starting"}
                  </th>
                  <th scope="col" className={thRight}>Money in</th>
                  <th scope="col" className={thRight}>Money out</th>
                  <th scope="col" className={thRight}>Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {trend.map((b) => (
                  <tr key={b.bucketStart}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-text-primary">
                      {bucketLabel(b.bucketStart, granularity)}
                    </th>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(b.moneyInMinor)} />
                      <Bar value={b.moneyInMinor} max={trendMax} tone="in" />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(b.moneyOutMinor)} />
                      <Bar value={b.moneyOutMinor} max={trendMax} tone="out" />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <InsightAmount text={money(b.netMinor, true)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default async function InsightsPage({
  searchParams,
}: PageProps<"/insights">) {
  const ctx = await getInsightsContext();
  if (!ctx) notFound();

  const sp = await searchParams;
  const tz = ctx.timezone;
  const query = parseInsightsQuery(sp, zonedDateKey(new Date(), tz));
  const win = resolveWindow(query, tz);
  const periodLabel = query.fromKey === query.toKey
    ? formatDateKeyLabel(query.fromKey)
    : `${formatDateKeyLabel(query.fromKey)} – ${formatDateKeyLabel(query.toKey)}`;

  const load = await loadInsightsDataset(ctx, win.prevFrom, win.to, win.from);

  if (!load.ok) {
    return (
      <div>
        <PageHeader title="Insights" subtitle={periodLabel} />
        <div role="alert" className={`${card} text-sm text-text-secondary`}>
          {load.reason === "too_many_rows"
            ? (
              <>
                <p className="font-medium text-text-primary">
                  This period has too many transactions to total reliably here.
                </p>
                <p className="mt-1">
                  Choose a shorter period. Nothing is shown rather than a
                  partial total.
                </p>
              </>
            )
            : (
              <>
                <p className="font-medium text-text-primary">
                  We couldn’t load your insights.
                </p>
                <p className="mt-1">
                  No totals are shown because they might be incomplete.
                </p>
              </>
            )}
          <p className="mt-3">
            <Link href="/insights" className={link}>Try again</Link>
          </p>
        </div>
      </div>
    );
  }

  const data = load.data;
  const sourceLabels = new Map(data.sources.map((s) => [s.sourceId, s.label]));
  const scope = scopeFor(query, win.from, win.to);
  const all = computeOverview(data.facts, scope, data.linked);
  const prev = computeOverview(
    data.facts,
    scopeFor(query, win.prevFrom, win.from),
    data.linked,
  );
  const blocks = all.currencies.filter((o) =>
    !query.currency || o.currency === query.currency
  );
  const coverage = historyCoverage(data.earliestTxnAt, win.prevFrom, win.from);
  const granularity = query.granularity ?? autoGranularity(win.days);

  // Filter choices come from the unfiltered period, so picking one category
  // never hides the others.
  const unfiltered = computeOverview(
    data.facts,
    { from: win.from, to: win.to },
    data.linked,
  );
  const categories = [
    ...new Set(
      unfiltered.currencies.flatMap((o) => o.byCategory.map((c) => c.category)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  if (query.category !== undefined && !categories.includes(query.category)) {
    categories.unshift(query.category);
  }
  const currencies = unfiltered.currencies.map((o) => o.currency);

  const excluded = excludedTotal(data.excluded);
  const staleDays = data.latestTxnAt
    ? Math.floor(
      (Date.parse(data.computedAt) - Date.parse(data.latestTxnAt)) /
        86_400_000,
    )
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <PageHeader
          title="Insights"
          subtitle={`${periodLabel} · times in ${tz.replace(/_/g, " ")}`}
        />
        <InsightsFilters
          query={query}
          sources={data.sources}
          categories={categories}
          currencies={currencies}
        />
      </div>

      {data.latestTxnAt === null
        ? (
          <EmptyState
            variant="setup"
            title="No transactions yet"
            description="Insights are built only from transactions in this Space. Connect a wallet or add a transaction to get started."
            action={
              <Link href="/transactions/new" className={link}>
                Add a transaction
              </Link>
            }
          />
        )
        : blocks.length === 0
        ? (
          <EmptyState
            title="Nothing to show for this period"
            description="No transactions match the period and filters you chose."
          />
        )
        : blocks.map((o) => (
          <CurrencySection
            key={o.currency}
            o={o}
            previous={prev.currencies.find((p) => p.currency === o.currency)}
            coverage={coverage}
            query={query}
            days={win.days}
            trend={computeTrend(
              data.facts,
              scope,
              o.currency,
              data.linked,
              granularity,
              tz,
            )}
            granularity={granularity}
            sourceLabels={sourceLabels}
          />
        ))}

      {blocks.length > 1 && (
        <p className="text-xs text-text-muted">
          Each currency is totalled separately. Amounts are never converted
          or added across currencies.
        </p>
      )}

      {excluded > 0 && (
        <div role="note" className="rounded-card bg-attention-bg p-3 text-sm text-attention">
          <p className="font-medium">
            {excluded} transaction{excluded === 1 ? " is" : "s are"}{" "}
            not included in these totals.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {data.excluded.unknownSettlement > 0 && (
              <li>
                {data.excluded.unknownSettlement}{" "}
                where we can’t tell whether the payment went through.
              </li>
            )}
            {data.excluded.reversed > 0 && (
              <li>{data.excluded.reversed} that were reversed.</li>
            )}
            {data.excluded.uncomputed > 0 && (
              <li>
                {data.excluded.uncomputed} still being processed.
              </li>
            )}
          </ul>
          <p className="mt-1">
            This count covers the whole period, before any wallet or category
            filter.{" "}
            <Link href="/transactions/review" className="font-medium underline">
              Open the review queue
            </Link>
          </p>
        </div>
      )}

      {data.latestTxnAt !== null && (
        <p className="text-xs text-text-muted">
          Latest transaction recorded{" "}
          {formatZonedDateTime(data.latestTxnAt, tz)}. Calculated{" "}
          {formatZonedDateTime(data.computedAt, tz)}{" "}
          from transactions in this Space only — a transaction that never
          reached OneLedger is not reflected.
          {staleDays >= STALE_AFTER_DAYS && (
            <>
              {" "}Nothing new has arrived for {staleDays} days.{" "}
              <Link href="/settings/sources" className={link}>
                Check your connected sources
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
