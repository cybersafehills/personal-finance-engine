// Pure formatting + comparison helpers (unit-tested).

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** Percentage change current vs previous; null when previous is 0 (undefined). */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export type Delta = { text: string; direction: "up" | "down" | "flat" | "none" };

export function describeDelta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { text: "No change", direction: "flat" };
  const pct = percentChange(current, previous);
  if (pct === null) {
    return { text: `New (${formatCount(previous)} previously)`, direction: "none" };
  }
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return { text: "No change", direction: "flat" };
  const sign = rounded > 0 ? "+" : "−";
  return {
    text: `${sign}${Math.abs(rounded)}%`,
    direction: rounded > 0 ? "up" : "down",
  };
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kigali",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  personal_plus: "Personal Plus",
  household: "Household",
  business: "Business",
};

/** "staff_directory.viewed" -> "Staff directory viewed". Unknown input is tidied, never dropped. */
export function humanizeAction(action: string): string {
  const t = action.replace(/[._]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", day: "2-digit", month: "short", year: "numeric" }).format(d);
}

/** "RWF 2,500". Whole francs only; RWF has no minor unit in use. */
export function formatRwf(n: number): string {
  return `RWF ${new Intl.NumberFormat("en-US").format(Math.round(n))}`;
}

/** Share as a whole percent, or null when the denominator is 0 (no data, not "0%"). */
export function ratePercent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
