import { formatSignedRwf } from "../lib/format";
import { WhyThisInsight } from "./ds/WhyThisInsight";
import type { IntelligenceInsights } from "../lib/intelligence/insights";

// Release 6 (Intelligence) surface, dark unless INTELLIGENCE_ENABLED.
// Deterministic facts only (ADR 0014): a conservative cash-flow forecast
// with the known/scheduled and estimated halves kept separate, a
// spending-baseline comparison, and detected recurring payments. Every
// block carries "Why am I seeing this?". No decorative charts.

function rwf(minor: number): string {
  return formatSignedRwf(minor);
}

export function IntelligenceCard({
  insights,
}: {
  insights: IntelligenceInsights;
}) {
  const { forecast, baseline, recurring, anomalies } = insights;
  if (!insights.enabled) return null;
  if (
    !forecast && !baseline && recurring.length === 0 && anomalies.length === 0
  ) {
    return null;
  }

  return (
    <section
      aria-label="Insights"
      className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-text-primary">Insights</h2>

      {forecast && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-primary">
            Projected balance in {forecast.horizonDays} days
          </p>
          <p className="text-sm text-text-secondary">
            Scheduled items only:{" "}
            <span className="tabular-nums">
              {rwf(forecast.projectedEnd.knownBalanceMinor)}
            </span>
            {forecast.projectedEnd.estimatedBalanceMinor !==
                forecast.projectedEnd.knownBalanceMinor && (
              <>
                {" · with everyday spending: "}
                <span className="tabular-nums">
                  {rwf(forecast.projectedEnd.estimatedBalanceMinor)}
                </span>
              </>
            )}
          </p>
          {forecast.mayGoNegative && (
            <p className="rounded-control bg-attention-bg p-2 text-xs text-attention">
              Your balance could dip below zero around day{" "}
              {forecast.projectedLow.dayOffset} if spending continues at your
              recent pace.
            </p>
          )}
          <p className="text-xs text-text-muted">{forecast.disclaimer}</p>
          <WhyThisInsight
            basis={forecast.basis}
            period={`Next ${forecast.horizonDays} days`}
            method="Current balance, plus dated recurring items and bills, minus an estimated flat daily spend from your last 90 days."
          />
        </div>
      )}

      {baseline && baseline.changePercent != null && (
        <div className="flex flex-col gap-1 border-t border-border-subtle pt-3">
          <p className="text-sm font-medium text-text-primary">
            Spending this month
          </p>
          <p className="text-sm text-text-secondary">
            <span className="tabular-nums">
              {rwf(-Math.abs(baseline.thisMonthToDateRwf))}
            </span>{" "}
            so far &mdash;{" "}
            {baseline.direction === "in_line"
              ? "about the same as"
              : `${Math.abs(baseline.changePercent)}% ${baseline.direction}`}{" "}
            your recent pace.
          </p>
          <WhyThisInsight
            basis={baseline.basis}
            period={`This month vs your last ${baseline.monthsCompared} complete months`}
            method="Same first-N-days spend, this month vs the average of prior months."
          />
        </div>
      )}

      {anomalies.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border-subtle pt-3">
          <p className="text-sm font-medium text-text-primary">
            {anomalies.length === 1
              ? "An unusually large payment"
              : `${anomalies.length} unusually large payments`}
          </p>
          <ul className="flex flex-col gap-0.5 text-xs text-text-muted">
            {anomalies.slice(0, 4).map((a) => (
              <li key={`${a.counterpartyKey}:${a.occurredAt}`}>
                {a.counterpartyKey.replace(/\b\w/g, (c) => c.toUpperCase())}
                {" "}&middot; {rwf(-a.amountMinor)} &middot; about{" "}
                {a.timesTypical}&times; your usual {rwf(-a.typicalMinor)}
              </li>
            ))}
          </ul>
          <WhyThisInsight
            basis={[
              "A single payment far above what this counterparty has cost you before.",
              "Only counterparties with a stable payment history are checked.",
              "Flagged when it is at least 3x the usual amount and the gap is meaningful.",
            ]}
            period={`Last ${30} days`}
            method="Compared against the median of that counterparty's prior payments."
            confidence="high"
          />
        </div>
      )}

      {recurring.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border-subtle pt-3">
          <p className="text-sm font-medium text-text-primary">
            {recurring.length} recurring payment
            {recurring.length === 1 ? "" : "s"} detected
          </p>
          <ul className="flex flex-col gap-0.5 text-xs text-text-muted">
            {recurring.slice(0, 5).map((p) => (
              <li key={`${p.counterpartyKey}:${p.category ?? ""}`}>
                {p.counterpartyKey.replace(/\b\w/g, (c) => c.toUpperCase())}
                {" "}&middot; ~{rwf(-Number(p.typicalAmountMinor))} &middot; around
                day {p.typicalDayOfMonth} &middot; seen {p.monthsSeen} months
              </li>
            ))}
          </ul>
          <WhyThisInsight
            basis={[
              "Payments to the same counterparty, in the same category, at a similar amount.",
              "Seen in at least 2 of your last 4 complete months.",
              `Amounts within ${DEFAULT_TOLERANCE}% of each other count as the same payment.`,
            ]}
            period="Last 4 complete months"
            method="Grouped by counterparty + category; median amount and day; must recur across months."
          />
        </div>
      )}
    </section>
  );
}

const DEFAULT_TOLERANCE = 15;
