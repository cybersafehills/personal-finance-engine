import Link from "next/link";
import {
  type InsightsQuery,
  PERIOD_PRESETS,
} from "../../lib/insights/insights-params";

const control =
  "min-h-11 w-full rounded-control border border-border-subtle bg-background px-3 py-2 text-base text-text-primary";
const label = "flex flex-col gap-1 text-xs font-medium text-text-secondary";

/**
 * A plain GET form - works without JavaScript, and the URL is the whole
 * state, so a view can be bookmarked or shared within the Space.
 */
export function InsightsFilters({
  query,
  sources,
  categories,
  currencies,
}: {
  query: InsightsQuery;
  sources: { sourceId: string; label: string }[];
  categories: string[];
  currencies: string[];
}) {
  const filtered = query.sourceIds.length > 0 || query.category !== undefined ||
    query.currency !== undefined;
  return (
    <form
      method="get"
      action="/insights"
      aria-label="Insights filters"
      className="mb-4 grid grid-cols-2 gap-3 rounded-card border border-border-subtle bg-surface p-3 sm:grid-cols-4"
    >
      <label className={`${label} col-span-2 sm:col-span-1`}>
        Period
        <select name="period" defaultValue={query.preset} className={control}>
          {PERIOD_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className={label}>
        From
        <input
          type="date"
          name="from"
          defaultValue={query.fromKey}
          className={control}
          aria-describedby="insights-dates-hint"
        />
      </label>
      <label className={label}>
        To
        <input
          type="date"
          name="to"
          defaultValue={query.toKey}
          className={control}
          aria-describedby="insights-dates-hint"
        />
      </label>
      {sources.length > 1 && (
        <label className={label}>
          Wallet
          <select
            name="account"
            defaultValue={query.sourceIds[0] ?? ""}
            className={control}
          >
            <option value="">All wallets</option>
            {sources.map((s) => (
              <option key={s.sourceId} value={s.sourceId}>{s.label}</option>
            ))}
          </select>
        </label>
      )}
      {categories.length > 0 && (
        <label className={label}>
          Category
          <select
            name="category"
            defaultValue={query.category ?? ""}
            className={control}
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {currencies.length > 1 && (
        <label className={label}>
          Currency
          <select
            name="currency"
            defaultValue={query.currency ?? ""}
            className={control}
          >
            <option value="">All currencies</option>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      <label className={label}>
        Trend by
        <select
          name="granularity"
          defaultValue={query.granularity ?? ""}
          className={control}
        >
          <option value="">Automatic</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
      </label>
      <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-4">
        <button
          type="submit"
          className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
        >
          Update
        </button>
        {filtered && (
          <Link
            href="/insights"
            className="text-sm font-medium text-accent hover:underline"
          >
            Clear filters
          </Link>
        )}
        <p id="insights-dates-hint" className="text-xs text-text-muted">
          From and To apply when Period is “Custom dates” (up to one year).
        </p>
      </div>
    </form>
  );
}
