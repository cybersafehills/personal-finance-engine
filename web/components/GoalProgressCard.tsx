import { formatMoney, isSupportedCurrency } from "../lib/money";
import type { GoalProgress } from "../lib/queries";

/**
 * The §26 computed goal metrics, from goal_progress(). Server component -
 * no interactivity. Shown for every goal (personal or shared).
 */
export function GoalProgressCard({
  progress,
  currency,
}: {
  progress: GoalProgress;
  currency: string;
}) {
  if (!isSupportedCurrency(currency)) return null;

  const money = (minor: number) => formatMoney(BigInt(Math.round(minor)), currency);
  const remaining = Math.max(progress.targetMinor - progress.currentMinor, 0);
  const onTrack =
    remaining === 0 ||
    (progress.requiredMonthlyMinor > 0 &&
      progress.recentMonthlyRateMinor >= progress.requiredMonthlyMinor);

  return (
    <section
      aria-label="Goal progress"
      className="mb-4 rounded-card border border-border-subtle bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        Progress
      </p>
      <dl className="mt-2 flex flex-col divide-y divide-border-subtle text-sm">
        <Row label="Remaining" value={money(remaining)} />
        {progress.monthsToTarget !== null && (
          <Row
            label="Time to target date"
            value={`${progress.monthsToTarget.toFixed(1)} months`}
          />
        )}
        {progress.requiredMonthlyMinor > 0 && (
          <Row
            label="Needed per month"
            value={`${money(progress.requiredMonthlyMinor)} to hit the target date`}
          />
        )}
        <Row
          label="Recent contribution rate"
          value={
            progress.recentMonthlyRateMinor > 0
              ? `${money(progress.recentMonthlyRateMinor)} / month (last 90 days)`
              : "No contributions in the last 90 days"
          }
        />
        {progress.projectedCompletionDate && (
          <Row
            label="Projected completion"
            value={
              remaining === 0
                ? "Reached"
                : `~ ${progress.projectedCompletionDate} at the current rate`
            }
          />
        )}
      </dl>
      {progress.requiredMonthlyMinor > 0 && progress.recentMonthlyRateMinor > 0 && (
        <p
          className={`mt-2 text-sm ${
            onTrack ? "text-money-positive" : "text-attention"
          }`}
        >
          {onTrack
            ? "On track for the target date."
            : "Below the pace needed for the target date."}
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-medium text-text-primary">{value}</span>
    </div>
  );
}
