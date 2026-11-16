// Pure copy and arithmetic for the Home cards, mirroring the web's wording
// (web/components/BudgetStatusCard.tsx, BalanceCard.tsx).

import type { AllocationStatus } from "@/features/budgets/types";
import { kigaliDateKey } from "@/lib/kigali-time";

export type HomeStatus = { label: string; variant: "positive" | "attention" | "neutral" };

/** The Home budget badge. Wording differs slightly from the Budget screen's, as on the web. */
const STATUS: Record<AllocationStatus, HomeStatus> = {
  healthy: { label: "On track", variant: "positive" },
  watch: { label: "Approaching limit", variant: "attention" },
  at_risk: { label: "Near limit", variant: "attention" },
  exceeded: { label: "Over budget", variant: "attention" },
  insufficient_data: { label: "Not enough data", variant: "neutral" },
};

export function homeStatus(status: AllocationStatus): HomeStatus {
  return STATUS[status];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole Kigali days from today to the period's last day (0 on the last day, never negative). */
export function daysRemaining(periodEndKey: string, nowIso: string): number | null {
  const end = Date.parse(`${periodEndKey}T00:00:00Z`);
  const today = Date.parse(`${kigaliDateKey(nowIso)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(today)) return null;
  return Math.max(0, Math.round((end - today) / DAY_MS));
}

export function daysLeftLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "Last day";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** Fraction 0-1 for the bar, null when there is no target to measure against. */
export function usedFraction(percentUsed: number | null): number | null {
  if (percentUsed === null) return null;
  return Math.min(1, Math.max(0, percentUsed / 100));
}
