import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { TransactionList } from "../../../components/TransactionList";
import { formatDateKeyLabel } from "../../../lib/format";
import { getTransactionsByIds } from "../../../lib/queries";
import { zonedDateKey } from "../../../lib/report-period";
import {
  getInsightsContext,
  loadInsightsDataset,
} from "../../../lib/insights/insights-page-data";
import { applyDrilldown } from "../../../lib/insights/insights-math";
import {
  drilldownTitle,
  insightsQueryString,
  parseDrilldown,
  parseInsightsQuery,
  resolveWindow,
  scopeFor,
} from "../../../lib/insights/insights-params";

export const dynamic = "force-dynamic";

const MAX_ROWS_SHOWN = 200;
const card = "rounded-card border border-border-subtle bg-surface p-4";
const link = "font-medium text-accent hover:underline";

/**
 * The transactions behind one Insights figure. The rows are selected by the
 * SAME classification the total was computed with (applyDrilldown), from the
 * same loader - so this list can never disagree with the number it explains.
 */
export default async function InsightsDrilldownPage({
  searchParams,
}: PageProps<"/insights/transactions">) {
  const ctx = await getInsightsContext();
  if (!ctx) notFound();

  const sp = await searchParams;
  const request = parseDrilldown(sp);
  if (!request) notFound();

  const tz = ctx.timezone;
  const query = parseInsightsQuery(sp, zonedDateKey(new Date(), tz));
  const win = resolveWindow(query, tz);
  const backHref = `/insights?${insightsQueryString(query)}`;
  const periodLabel = query.fromKey === query.toKey
    ? formatDateKeyLabel(query.fromKey)
    : `${formatDateKeyLabel(query.fromKey)} – ${formatDateKeyLabel(query.toKey)}`;

  const load = await loadInsightsDataset(ctx, win.from, win.to);
  let rows: Awaited<ReturnType<typeof getTransactionsByIds>> | null = null;
  let matched = 0;
  let label: string | undefined;

  if (load.ok) {
    const facts = applyDrilldown(
      load.data.facts,
      {
        scope: scopeFor(query, win.from, win.to),
        currency: request.currency,
        kind: request.kind,
        value: request.value,
      },
      load.data.linked,
    );
    matched = facts.length;
    if (request.kind === "account") {
      label = load.data.sources.find((s) => s.sourceId === request.value)
        ?.label;
    } else if (
      request.kind === "counterparty_sent" ||
      request.kind === "counterparty_received"
    ) {
      label = facts[0]?.counterpartyName?.trim() || undefined;
    }
    // Newest first; the cap is on what is LISTED, never on what was counted.
    const ids = facts
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, MAX_ROWS_SHOWN)
      .map((f) => f.id);
    try {
      rows = await getTransactionsByIds(ids);
    } catch (e) {
      console.error(
        "insights drill-down failed:",
        e instanceof Error ? e.message : "unknown error",
      );
    }
  }

  const title = drilldownTitle(request, label);

  if (!load.ok || rows === null) {
    return (
      <div>
        <PageHeader
          title={title}
          subtitle={periodLabel}
          backHref={backHref}
          backLabel="Insights"
        />
        <div role="alert" className={`${card} text-sm text-text-secondary`}>
          <p className="font-medium text-text-primary">
            {!load.ok && load.reason === "too_many_rows"
              ? "This period has too many transactions to list reliably here."
              : "We couldn’t load these transactions."}
          </p>
          <p className="mt-1">
            Nothing is shown rather than a partial list.{" "}
            <Link href={backHref} className={link}>Back to Insights</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`${periodLabel} · ${request.currency}`}
        backHref={backHref}
        backLabel="Insights"
      />
      <p className="mb-3 text-sm text-text-muted">
        {matched === 0
          ? "No transactions are behind this figure."
          : matched > rows.length
          ? `Showing the ${rows.length} most recent of ${matched} transactions behind this figure.`
          : `${matched} transaction${matched === 1 ? "" : "s"} behind this figure.`}
        {request.kind === "money_out" &&
          " Includes refunds (which reduce the total) and fees charged on money received."}
        {request.kind === "category" &&
          " Refunds in this category reduce its total."}
      </p>
      <TransactionList
        transactions={rows}
        emptyTitle="No transactions for this figure"
      />
    </div>
  );
}
