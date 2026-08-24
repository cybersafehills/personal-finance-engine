import { Badge } from "./Badge";
import { formatMoney, SupportedCurrency } from "../lib/money";
import type { AllocationActual, AllocationStatus } from "../lib/queries";
import type { AllocationType } from "../lib/budget-math";

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

const STATUS_DISPLAY: Record<
  AllocationStatus,
  { label: string; variant: "accent" | "neutral" | "attention" | "positive" }
> = {
  healthy: { label: "Healthy", variant: "positive" },
  watch: { label: "Watch", variant: "accent" },
  at_risk: { label: "At risk", variant: "attention" },
  exceeded: { label: "Exceeded", variant: "attention" },
  insufficient_data: { label: "Insufficient data", variant: "neutral" },
};

export function AllocationActualsCard({
  actual,
  currency,
}: {
  actual: AllocationActual;
  currency: SupportedCurrency;
}) {
  const status = STATUS_DISPLAY[actual.status];
  const percent = actual.percentConsumed !== null
    ? Math.round(actual.percentConsumed)
    : null;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">
          {ALLOCATION_LABELS[actual.allocationType]}
        </span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-text-secondary">
          {formatMoney(BigInt(actual.actualMinor), currency)} of{" "}
          {formatMoney(BigInt(actual.targetMinor), currency)}
        </span>
        {percent !== null && (
          <span className="text-xs text-text-muted">{percent}%</span>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-background" role="presentation">
        <div
          className={`h-full ${status.variant === "attention" ? "bg-attention" : "bg-accent"}`}
          style={{ width: `${Math.min(100, percent ?? 0)}%` }}
        />
      </div>

      <p className="text-xs text-text-muted">
        {actual.remainingMinor >= 0
          ? `${formatMoney(BigInt(actual.remainingMinor), currency)} remaining`
          : `${formatMoney(BigInt(-actual.remainingMinor), currency)} over target`}
        {actual.projectedMinor !== null && (
          <> · projected {formatMoney(BigInt(Math.round(actual.projectedMinor)), currency)} by month end</>
        )}
      </p>
    </div>
  );
}
