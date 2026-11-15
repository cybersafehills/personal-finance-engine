import type { AllocationStatus, BudgetAllocation } from "./types";

export type StatusDisplay = { label: string; variant: "positive" | "neutral" | "attention" };

const STATUS_DISPLAY: Record<AllocationStatus, StatusDisplay> = {
  healthy: { label: "On track", variant: "positive" },
  watch: { label: "Watch", variant: "attention" },
  at_risk: { label: "Nearing limit", variant: "attention" },
  exceeded: { label: "Over budget", variant: "attention" },
  insufficient_data: { label: "Not enough data yet", variant: "neutral" },
};

export function statusDisplay(status: AllocationStatus): StatusDisplay {
  return STATUS_DISPLAY[status];
}

const SEVERITY_RANK: Record<AllocationStatus, number> = {
  insufficient_data: 0,
  healthy: 1,
  watch: 2,
  at_risk: 3,
  exceeded: 4,
};

/** The most worrying status across allocations (same ordering the web uses). */
export function worstStatus(allocations: readonly BudgetAllocation[]): AllocationStatus {
  return allocations.reduce<AllocationStatus>(
    (worst, a) => (SEVERITY_RANK[a.status] > SEVERITY_RANK[worst] ? a.status : worst),
    "insufficient_data",
  );
}

/** Bar fill 0-1. A target of 0 with spending against it shows as full. */
export function barFraction(a: Pick<BudgetAllocation, "percentConsumed" | "actualMinor">): number {
  if (a.percentConsumed === null) return a.actualMinor > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, a.percentConsumed / 100));
}

export function totals(allocations: readonly BudgetAllocation[]) {
  const targetMinor = allocations.reduce((s, a) => s + a.targetMinor, 0);
  const actualMinor = allocations.reduce((s, a) => s + a.actualMinor, 0);
  return {
    targetMinor,
    actualMinor,
    remainingMinor: targetMinor - actualMinor,
    percentUsed: targetMinor > 0 ? (actualMinor / targetMinor) * 100 : null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`.trim();
}

/** "1 Nov – 30 Nov" (the year only when the period crosses years). */
export function periodLabel(startKey: string, endKey: string): string {
  const sameYear = startKey.slice(0, 4) === endKey.slice(0, 4);
  return sameYear
    ? `${dayMonth(startKey)} – ${dayMonth(endKey)}`
    : `${dayMonth(startKey)} ${startKey.slice(0, 4)} – ${dayMonth(endKey)} ${endKey.slice(0, 4)}`;
}

/** "62% of the period has passed", or null outside the period. */
export function paceLabel(elapsedFraction: number | null): string | null {
  if (elapsedFraction === null) return null;
  return `${Math.round(elapsedFraction * 100)}% of the period has passed`;
}
