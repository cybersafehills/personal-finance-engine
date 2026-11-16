import type { CategoryTotal } from "./types";
import { UNCATEGORIZED } from "./types";

/** All spending shown: the base each category's share is measured against. */
export function grandTotal(categories: readonly CategoryTotal[]): number {
  return categories.reduce((sum, c) => sum + c.totalRwf, 0);
}

/**
 * Bar fill 0-1. A tiny category still gets a visible sliver (the web's 2% floor)
 * so it never reads as zero; a zero total reads as empty.
 */
export function barFraction(totalRwf: number, grand: number): number {
  if (grand <= 0 || totalRwf <= 0) return 0;
  return Math.min(1, Math.max(totalRwf / grand, 0.02));
}

/** "1 transaction" / "12 transactions". */
export function countLabel(count: number): string {
  return `${count} ${count === 1 ? "transaction" : "transactions"}`;
}

export const needsReview = (category: string): boolean => category === UNCATEGORIZED;

/** A short line for a screen reader, since the bar alone says nothing. */
export function shareLabel(totalRwf: number, grand: number): string {
  if (grand <= 0) return "";
  const percent = (totalRwf / grand) * 100;
  return percent < 1 ? "under 1% of spending" : `${Math.round(percent)}% of spending`;
}
