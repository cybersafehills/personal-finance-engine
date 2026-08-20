// Africa/Kigali financial-day boundaries.
//
// Vendored copy of supabase/functions/_shared/kigali-time.ts. That file
// can't be imported directly here: Vercel's build for this Next.js
// project only uploads the web/ directory, so a cross-repo relative
// import (which works in local dev, where the whole monorepo is present)
// fails to resolve at deploy time. Reconfiguring Vercel's project root to
// span the whole monorepo just to avoid duplicating ~15 lines of stable,
// dependency-free date arithmetic would add more deployment complexity
// than it saves - this file is genuinely a plain copy, not a
// reimplementation, and the canonical source stays authoritative.
//
// Keep in sync with supabase/functions/_shared/kigali-time.ts if Rwanda's
// UTC offset or DST status ever changes (it hasn't, for decades).

const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
