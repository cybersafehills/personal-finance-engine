"use client";

import Link from "next/link";
import { Badge } from "./Badge";
import { usePrivacy } from "./PrivacyProvider";
import { formatRwf } from "../lib/format";
import type { AllocationStatus } from "../lib/budget-math";

const STATUS_COPY: Record<AllocationStatus, { label: string; variant: "positive" | "attention" | "neutral" }> = {
  healthy: { label: "On track", variant: "positive" },
  watch: { label: "Approaching limit", variant: "attention" },
  at_risk: { label: "Near limit", variant: "attention" },
  exceeded: { label: "Over budget", variant: "attention" },
  insufficient_data: { label: "Not enough data", variant: "neutral" },
};

/**
 * Concise dashboard summary of the caller's one active budget - a status
 * badge, percent used, remaining amount, and time left in the period,
 * linking to the full Budgets detail rather than duplicating it (master
 * prompt §8.2). Amounts respect full privacy mode; the status badge and
 * day count are never masked since they carry no monetary value on their
 * own. Deliberately never renders a red/alarming color - this codebase's
 * own design tokens (globals.css) treat spending as restrained, primary-
 * colored text, not red, and that direction applies here too.
 */
export function BudgetStatusCard({
  budgetId,
  totalTargetMinor,
  totalActualMinor,
  remainingMinor,
  percentUsed,
  worstStatus,
  daysRemainingInPeriod,
}: {
  budgetId: string;
  totalTargetMinor: number;
  totalActualMinor: number;
  remainingMinor: number;
  percentUsed: number | null;
  worstStatus: AllocationStatus;
  daysRemainingInPeriod: number | null;
}) {
  const { isDashboardMasked } = usePrivacy();
  const { label, variant } = STATUS_COPY[worstStatus];
  const clampedPercent = percentUsed !== null ? Math.min(100, Math.max(0, percentUsed)) : null;

  return (
    <Link
      href={`/budgets/${budgetId}`}
      className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background focus-visible:bg-background"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Budget status
        </h2>
        <Badge variant={variant}>{label}</Badge>
      </div>

      {clampedPercent !== null && (
        <>
          <div
            role="progressbar"
            aria-valuenow={Math.round(clampedPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Budget used"
            className="h-1.5 w-full overflow-hidden rounded-full bg-background"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${clampedPercent}%` }}
            />
          </div>
          <p className="text-xs text-text-muted">
            {isDashboardMasked
              ? "••••• of ••••• used"
              : `${formatRwf(totalActualMinor)} of ${formatRwf(totalTargetMinor)} used`}
          </p>
        </>
      )}

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted">
            {remainingMinor < 0 ? "Over by" : "Remaining"}
          </p>
          {isDashboardMasked ? (
            <p className="text-2xl font-semibold tabular-nums text-text-muted" aria-label="Amount hidden">
              ••••••
            </p>
          ) : (
            <p className="text-2xl font-semibold tabular-nums text-text-primary">
              {formatRwf(remainingMinor)}
            </p>
          )}
        </div>
        {daysRemainingInPeriod !== null && (
          <p className="text-xs text-text-muted">
            {daysRemainingInPeriod === 0
              ? "Last day"
              : daysRemainingInPeriod === 1
                ? "1 day left"
                : `${daysRemainingInPeriod} days left`}
          </p>
        )}
      </div>
    </Link>
  );
}
