import { formatRwf } from "../lib/format";
import type { TrendComparison } from "../lib/report-math";

/** Formats a trend's current value the way its metric naturally reads - a plain count for transaction_count, RWF for everything else. */
function formatTrendValue(trend: TrendComparison, value: number): string {
  return trend.metric === "transaction_count" ? `${Math.round(value)}` : formatRwf(value);
}

/**
 * Whether an increase in this metric is favorable - determines which
 * direction gets the positive/negative color. Spending and fees going up
 * is unfavorable; income going up is favorable; a transaction-count change
 * is neither, so it stays neutral (no color).
 */
function increaseIsFavorable(metric: TrendComparison["metric"]): boolean | null {
  if (metric === "income") return true;
  if (metric === "spend" || metric === "fees") return false;
  return null;
}

export function ReportTrendsList({ trends }: { trends: TrendComparison[] }) {
  const withHistory = trends.filter((t) => t.comparisonValue !== null);

  if (withHistory.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Not enough history yet for a trend comparison.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border-subtle text-sm">
      {withHistory.map((trend) => {
        const favorable = increaseIsFavorable(trend.metric);
        const isIncrease = (trend.changePercent ?? 0) > 0;
        const colorClass = trend.changePercent === null || favorable === null
          ? "text-text-muted"
          : isIncrease === favorable
          ? "text-money-positive"
          : "text-money-negative";

        return (
          <div key={trend.metric} className="flex items-center justify-between gap-2 py-2.5">
            <span className="text-text-muted">{trend.label}</span>
            <span className="flex items-center gap-2">
              <span className="font-medium text-text-primary">
                {formatTrendValue(trend, trend.currentValue)}
              </span>
              {trend.changePercent !== null && (
                <span className={`text-xs font-medium ${colorClass}`}>
                  {isIncrease ? "+" : ""}
                  {Math.round(trend.changePercent)}%
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
