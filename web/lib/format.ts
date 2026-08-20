import { kigaliDateKey } from "./kigali-time";

const rwfFormatter = new Intl.NumberFormat("en-RW", {
  style: "decimal",
  maximumFractionDigits: 0,
});

/** Formats a whole-RWF integer as "1,234 RWF" (no sign). */
export function formatRwf(amount: number): string {
  return `${rwfFormatter.format(Math.abs(amount))} RWF`;
}

/** Formats a signed effect with an explicit +/- prefix, e.g. "+7,500 RWF". */
export function formatSignedRwf(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${rwfFormatter.format(Math.abs(amount))} RWF`;
}

const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Short local (Kigali) date/time for a transaction list row, e.g. "Aug 20, 14:03". */
export function formatDateTime(occurredAtIso: string): string {
  const shifted = new Date(new Date(occurredAtIso).getTime() + KIGALI_OFFSET_MS);
  return shifted.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Local (Kigali) time only, e.g. "14:03" - for rows under a date group header. */
export function formatTime(occurredAtIso: string): string {
  const shifted = new Date(new Date(occurredAtIso).getTime() + KIGALI_OFFSET_MS);
  return shifted.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * Groups a list of ISO instants into "Today" / "Yesterday" / "August 18"
 * buckets, derived entirely from existing occurred_at values (no new
 * backend data) using the same Kigali calendar-day definition as the
 * Home screen's "today" totals.
 */
export function dateGroupLabel(occurredAtIso: string): string {
  const key = kigaliDateKey(occurredAtIso);
  const todayKey = kigaliDateKey(new Date().toISOString());
  const yesterdayKey = kigaliDateKey(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );

  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";

  const shifted = new Date(new Date(occurredAtIso).getTime() + KIGALI_OFFSET_MS);
  return shifted.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Full local (Kigali) date/time for a transaction detail view. */
export function formatFullDateTime(occurredAtIso: string): string {
  const shifted = new Date(new Date(occurredAtIso).getTime() + KIGALI_OFFSET_MS);
  return shifted.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
