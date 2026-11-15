// Africa/Kigali day boundaries and display formatting. Port of
// web/lib/kigali-time.ts and the date helpers in web/lib/format.ts.
// Rwanda is UTC+2 with no daylight saving. Formatting is done by hand (no
// Intl) so every phone renders identically regardless of its locale data.

const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function shifted(instantIso: string): Date {
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid ISO instant: ${instantIso}`);
  }
  return new Date(instant.getTime() + KIGALI_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Kigali calendar day of an instant, as YYYY-MM-DD. */
export function kigaliDateKey(instantIso: string): string {
  const d = shifted(instantIso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** UTC instants bounding a Kigali calendar day (inclusive). */
export function kigaliDayBoundsUtc(dateKey: string): { startUtc: Date; endUtc: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const startUtc = new Date(Date.UTC(year, month - 1, day) - KIGALI_OFFSET_MS);
  return { startUtc, endUtc: new Date(startUtc.getTime() + DAY_MS - 1) };
}

/** Kigali time of day, 24-hour: "14:03". */
export function formatTime(instantIso: string): string {
  const d = shifted(instantIso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "Aug 20, 14:03" */
export function formatDateTime(instantIso: string): string {
  const d = shifted(instantIso);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${formatTime(instantIso)}`;
}

/** "20 August 2026, 14:03" */
export function formatFullDateTime(instantIso: string): string {
  const d = shifted(instantIso);
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${formatTime(instantIso)}`;
}

/** "Today" / "Yesterday" / "August 18" (with the year when it isn't this year). */
export function dateGroupLabel(instantIso: string, nowIso: string): string {
  const key = kigaliDateKey(instantIso);
  if (key === kigaliDateKey(nowIso)) return "Today";
  const yesterday = new Date(new Date(nowIso).getTime() - DAY_MS).toISOString();
  if (key === kigaliDateKey(yesterday)) return "Yesterday";
  const d = shifted(instantIso);
  const sameYear = d.getUTCFullYear() === shifted(nowIso).getUTCFullYear();
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}${sameYear ? "" : `, ${d.getUTCFullYear()}`}`;
}
