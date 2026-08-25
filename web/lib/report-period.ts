// Timezone-aware daily reporting-period boundaries for the Scheduled
// Financial Reporting engine, for an ARBITRARY IANA timezone (not just
// Africa/Kigali - see kigali-time.ts, which is a deliberate fixed-offset
// shortcut documented there as Kigali-only and not safe to reuse verbatim
// for a multi-timezone feature like reporting; report_preferences.timezone
// can be any IANA zone a user configures).
//
// Zero imports (relies only on the built-in Intl API) so this can be unit-
// tested with `deno test`, matching this repository's established pattern
// for pure date/financial logic (budget-math.ts, money.ts).
//
// Reporting-period semantics (see the architecture assessment): a daily
// report's period_start/period_end always span one COMPLETE local calendar
// day in the report's configured timezone - generation runs shortly after
// local midnight for the day that just ended, not at a literal 23:00
// cutoff (which would exclude the day's own final hour). Both boundaries
// are computed here as genuine local-midnight UTC instants, correct across
// DST transitions, via the standard two-pass Intl.DateTimeFormat offset
// technique (see zonedUtcOffsetMs below) - one pass is enough for almost
// every timezone, but a transition can shift the offset between the two
// candidate instants, so the second pass re-measures at the corrected
// instant and is authoritative.

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDateKey(dateKey: string): void {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    throw new RangeError(`Expected a "YYYY-MM-DD" date key, got ${dateKey}`);
  }
}

/**
 * The UTC offset (in ms, positive = ahead of UTC) that `timeZone` observes
 * AT the given instant. Used only as the measurement primitive for the
 * local-midnight resolution below - not exposed as public API, since
 * "the offset for an instant" is never itself the thing a caller needs.
 */
function zonedUtcOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );

  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant corresponding to local wall-clock midnight
 * (00:00:00.000) on `dateKey` in `timeZone`. Two-pass: the first pass
 * measures the offset using a UTC-components guess (which is off by
 * exactly the offset itself), the second re-measures at the corrected
 * instant so a DST transition landing between the guess and the true
 * instant doesn't leave the result off by an hour.
 */
export function localMidnightUtc(dateKey: string, timeZone: string): Date {
  assertValidDateKey(dateKey);
  const [year, month, day] = dateKey.split("-").map(Number);
  const naiveUtcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  const firstOffset = zonedUtcOffsetMs(new Date(naiveUtcGuess), timeZone);
  const firstInstant = naiveUtcGuess - firstOffset;

  const secondOffset = zonedUtcOffsetMs(new Date(firstInstant), timeZone);
  const secondInstant = naiveUtcGuess - secondOffset;

  return new Date(secondInstant);
}

/** The "YYYY-MM-DD" calendar date `instant` falls on in `timeZone`. */
export function zonedDateKey(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("zonedDateKey: invalid instant");
  }
  // en-CA formats as YYYY-MM-DD directly - avoids hand-assembling parts.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant);
}

/** Shifts a "YYYY-MM-DD" date key by `deltaDays` (negative to go back), independent of any timezone - pure calendar arithmetic. */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  assertValidDateKey(dateKey);
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${shifted.getUTCFullYear()}-${
    String(shifted.getUTCMonth() + 1).padStart(2, "0")
  }-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export type ReportPeriod = {
  periodStartUtc: Date;
  periodEndUtc: Date;
  /** The local calendar date this period represents (period_start's date). */
  dateKey: string;
};

/**
 * The complete-local-calendar-day period for `dateKey` in `timeZone`:
 * [local midnight, next local midnight) - a half-open interval
 * (occurred_at >= periodStartUtc AND occurred_at < periodEndUtc), never an
 * ambiguous inclusive 23:59:59 upper bound (master prompt §44).
 */
export function dailyReportPeriod(
  dateKey: string,
  timeZone: string,
): ReportPeriod {
  const periodStartUtc = localMidnightUtc(dateKey, timeZone);
  const periodEndUtc = localMidnightUtc(shiftDateKey(dateKey, 1), timeZone);
  return { periodStartUtc, periodEndUtc, dateKey };
}

/**
 * The dateKey a daily report generated "shortly after local midnight" (or
 * at any other configured generationTime) should cover: the complete
 * calendar day that just ended, i.e. `nowInstant`'s local date minus one
 * day. This is deliberately independent of what generationTime happens to
 * be configured as - see the architecture assessment's period-semantics
 * decision (generation timing and period boundaries are two different
 * concerns, not the same timestamp read twice).
 */
export function previousCompleteDayKey(
  nowInstant: Date,
  timeZone: string,
): string {
  return shiftDateKey(zonedDateKey(nowInstant, timeZone), -1);
}
