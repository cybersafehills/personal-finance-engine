import { formatRwf } from "../lib/format";
import type { HouseholdSpendBreakdown } from "../lib/queries";

/**
 * Household spending this month, broken down by member. Deliberately a
 * neutral breakdown, not a comparison - no "X spent more than Y" framing,
 * and the percentage is shown as text so the bars are not the only
 * signal (master prompt §22, §56).
 */
export function HouseholdSpendingCard({
  breakdown,
}: {
  breakdown: HouseholdSpendBreakdown;
}) {
  return (
    <section
      aria-label="Household spending this month"
      className="rounded-card border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Spending · {breakdown.monthLabel}
        </h2>
        <span className="text-sm font-medium text-text-primary">
          {formatRwf(breakdown.totalMinor)}
        </span>
      </div>

      {breakdown.buckets.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">
          No spending recorded this month yet.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {breakdown.buckets.map((bucket) => (
            <li key={bucket.key}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-text-primary">{bucket.label}</span>
                <span className="text-text-muted">
                  {formatRwf(bucket.amountMinor)} · {bucket.percent}%
                </span>
              </div>
              <div
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(bucket.percent, 2)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
