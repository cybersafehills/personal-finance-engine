// Africa/Kigali financial-day boundaries.
//
// Rwanda has used a fixed UTC+02:00 offset year-round for decades and does
// not observe daylight saving time. That means "Africa/Kigali local time"
// can be computed correctly with simple, dependency-free arithmetic - no
// IANA timezone database is required in the Deno runtime. This is the same
// fixed offset the parser already assumes in
// ingest-momo/parser-utils.ts#parseOccurredAt ("+02:00").
//
// If Rwanda ever adopts DST, this module is the only place that needs to
// change - do not hardcode +02:00 anywhere else.

const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the Africa/Kigali calendar date ("YYYY-MM-DD") that a given
 * instant falls on. The instant is parsed as an absolute point in time
 * (any valid ISO 8601 string, regardless of the offset it was written
 * with), then shifted into Kigali local time - this is independent of the
 * host machine's own timezone, so it is safe to run on any server.
 */
export function kigaliDateKey(instantIso: string): string {
  const instant = new Date(instantIso);

  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid ISO instant: ${instantIso}`);
  }

  const shifted = new Date(instant.getTime() + KIGALI_OFFSET_MS);

  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Returns the UTC instants bounding a full Africa/Kigali calendar day
 * (00:00:00.000 through 23:59:59.999 Kigali local time), for a "YYYY-MM-DD"
 * date key as produced by kigaliDateKey. Intended for future daily-close
 * queries filtering transactions.occurred_at by financial day.
 */
export function kigaliDayBoundsUtc(
  dateKey: string,
): { startUtc: Date; endUtc: Date } {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }

  const [year, month, day] = dateKey.split("-").map(Number);

  const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const startUtc = new Date(localMidnightAsUtc - KIGALI_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

  return { startUtc, endUtc };
}
