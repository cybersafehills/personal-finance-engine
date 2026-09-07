// Statement period presets and resolution (Financial Documents Engine,
// Statements family - PR2). Turns a preset (or a custom From/To) into a
// half-open [periodStartUtc, periodEndUtc) instant range in a given IANA
// timezone, plus a human label for the document header.
//
// Zero DB access. Built on lib/report-period.ts's timezone primitives
// (localMidnightUtc / shiftDateKey / zonedDateKey) - DST-correct for any
// IANA zone - NOT on lib/kigali-time.ts (a Kigali-only fixed-offset
// shortcut). Unit-tested with `deno test`, matching report-period.ts /
// money.ts / budget-math.ts.
//
// Master prompt section 8: presets, a custom range, start <= end
// validation, explicit handling of future dates and an over-long range -
// and every adjustment is SURFACED (result.adjustments), never applied
// silently.

import {
  localMidnightUtc,
  shiftDateKey,
  zonedDateKey,
} from "./report-period.ts";

export const STATEMENT_PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "custom",
] as const;

export type StatementPeriodPreset = (typeof STATEMENT_PERIOD_PRESETS)[number];

/** Longest period a single statement may span. ~24 months (master prompt section 8). */
export const MAX_STATEMENT_RANGE_DAYS = 731;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type StatementPeriodInput = {
  preset: StatementPeriodPreset;
  /** Any IANA zone the user configured (e.g. "Africa/Kigali", "Europe/Paris"). */
  timezone: string;
  /** Required for preset === "custom": inclusive local calendar dates, "YYYY-MM-DD". */
  fromDateKey?: string;
  toDateKey?: string;
  /** The "now" instant; defaults to new Date(). Injectable for tests. */
  now?: Date;
};

export type ResolvedStatementPeriod = {
  preset: StatementPeriodPreset;
  timezone: string;
  /** Inclusive start instant. */
  periodStartUtc: Date;
  /** EXCLUSIVE end instant - occurred_at < periodEndUtc. */
  periodEndUtc: Date;
  /** Inclusive first local calendar day, "YYYY-MM-DD". */
  startDateKey: string;
  /** Inclusive last local calendar day, "YYYY-MM-DD". */
  endDateKey: string;
  /** Document header label, e.g. "1 August 2026 – 31 August 2026". */
  label: string;
  /** Non-empty when a requested boundary was changed. Never silent. */
  adjustments: string[];
};

export type StatementPeriodResolution =
  | { ok: true; period: ResolvedStatementPeriod }
  | { ok: false; error: string };

function isRealDateKey(key: string): boolean {
  if (!DATE_KEY_RE.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** First day of `dateKey`'s calendar month, as a "YYYY-MM-DD" key. */
export function firstOfMonthDateKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

/**
 * Shift a "YYYY-MM-DD" key by whole calendar months, clamping the day to
 * the target month's length (2026-01-31 minus 1 month -> 2026-02-28).
 */
export function addMonthsToDateKey(
  dateKey: string,
  deltaMonths: number,
): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  const ty = anchor.getUTCFullYear();
  const tm = anchor.getUTCMonth();
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad2(tm + 1)}-${pad2(Math.min(d, lastDay))}`;
}

/** "1 August 2026" for a "YYYY-MM-DD" local calendar date (no timezone conversion). */
export function formatStatementDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function periodLabel(startDateKey: string, endDateKey: string): string {
  return `${formatStatementDayLabel(startDateKey)} – ${
    formatStatementDayLabel(endDateKey)
  }`;
}

/**
 * Resolve a period request. On success the range is guaranteed non-empty,
 * no longer than MAX_STATEMENT_RANGE_DAYS, and not extending past `now`;
 * any clamp is listed in `period.adjustments`.
 */
export function resolveStatementPeriod(
  input: StatementPeriodInput,
): StatementPeriodResolution {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return { ok: false, error: "The current time could not be determined." };
  }

  let todayKey: string;
  try {
    todayKey = zonedDateKey(now, input.timezone);
  } catch {
    return { ok: false, error: `Unknown timezone "${input.timezone}".` };
  }

  const adjustments: string[] = [];

  let startDateKey: string;
  let endDateKey: string;
  // The exclusive end instant. For "to now" presets this is `now` itself
  // (a partial final day); for whole-day ranges it is next local midnight.
  let periodEndUtc: Date;

  switch (input.preset) {
    case "this_month": {
      startDateKey = firstOfMonthDateKey(todayKey);
      endDateKey = todayKey;
      periodEndUtc = now;
      break;
    }
    case "last_month": {
      const firstThisMonth = firstOfMonthDateKey(todayKey);
      startDateKey = addMonthsToDateKey(firstThisMonth, -1);
      endDateKey = shiftDateKey(firstThisMonth, -1);
      periodEndUtc = localMidnightUtc(firstThisMonth, input.timezone);
      break;
    }
    case "last_3_months":
    case "last_6_months":
    case "last_12_months": {
      const months = input.preset === "last_3_months"
        ? 3
        : input.preset === "last_6_months"
        ? 6
        : 12;
      startDateKey = addMonthsToDateKey(todayKey, -months);
      endDateKey = todayKey;
      periodEndUtc = now;
      break;
    }
    case "custom": {
      const from = input.fromDateKey ?? "";
      const to = input.toDateKey ?? "";
      if (!isRealDateKey(from) || !isRealDateKey(to)) {
        return {
          ok: false,
          error: "Enter a valid start and end date (YYYY-MM-DD).",
        };
      }
      if (from > to) {
        return {
          ok: false,
          error: "The start date must be on or before the end date.",
        };
      }
      if (from > todayKey) {
        return {
          ok: false,
          error: "The start date is in the future.",
        };
      }
      startDateKey = from;
      if (to > todayKey) {
        endDateKey = todayKey;
        periodEndUtc = now;
        adjustments.push(
          "The end date was adjusted to today; a statement cannot cover future dates.",
        );
      } else {
        endDateKey = to;
        periodEndUtc = localMidnightUtc(
          shiftDateKey(to, 1),
          input.timezone,
        );
      }
      break;
    }
    default: {
      return { ok: false, error: "Unknown statement period." };
    }
  }

  const periodStartUtc = localMidnightUtc(startDateKey, input.timezone);

  if (periodEndUtc.getTime() <= periodStartUtc.getTime()) {
    return { ok: false, error: "The selected period contains no days." };
  }

  const spanDays = (periodEndUtc.getTime() - periodStartUtc.getTime()) /
    86_400_000;
  if (spanDays > MAX_STATEMENT_RANGE_DAYS) {
    return {
      ok: false,
      error:
        "The maximum statement period is 24 months. Choose a shorter range.",
    };
  }

  return {
    ok: true,
    period: {
      preset: input.preset,
      timezone: input.timezone,
      periodStartUtc,
      periodEndUtc,
      startDateKey,
      endDateKey,
      label: periodLabel(startDateKey, endDateKey),
      adjustments,
    },
  };
}
