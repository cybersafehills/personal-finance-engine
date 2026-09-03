// Pure next-run computation for a scheduled export. Coarse cadence only
// (daily / weekly / monthly at a local hour). The timezone is applied as
// a fixed UTC offset lookup is out of scope here - callers pass a numeric
// offset in minutes (0 for UTC); DST is not modelled in Phase 1.

export type Cadence = "daily" | "weekly" | "monthly";

export type ScheduleSpec = {
  cadence: Cadence;
  hour: number; // 0-23 local
  dayOfWeek?: number | null; // 0 = Sunday, for weekly
  dayOfMonth?: number | null; // 1-28, for monthly
  offsetMinutes?: number; // local time = UTC + offsetMinutes
};

/**
 * The first run strictly after `after` that matches `spec`. Returns a UTC
 * ISO string.
 */
export function computeNextRun(spec: ScheduleSpec, after: Date): string {
  const offset = spec.offsetMinutes ?? 0;
  // Work in "local" ms by shifting the clock, compute, then shift back.
  const local = new Date(after.getTime() + offset * 60_000);

  const candidate = new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    spec.hour,
    0,
    0,
    0,
  ));

  const advanceDays = (d: Date, n: number) =>
    new Date(d.getTime() + n * 24 * 60 * 60_000);

  if (spec.cadence === "daily") {
    if (candidate <= local) return toUtcIso(advanceDays(candidate, 1), offset);
    return toUtcIso(candidate, offset);
  }

  if (spec.cadence === "weekly") {
    const target = ((spec.dayOfWeek ?? 1) % 7 + 7) % 7;
    let c = candidate;
    let guard = 0;
    while ((c.getUTCDay() !== target || c <= local) && guard < 14) {
      c = advanceDays(c, 1);
      guard += 1;
    }
    return toUtcIso(c, offset);
  }

  // monthly
  const dom = Math.min(Math.max(spec.dayOfMonth ?? 1, 1), 28);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth();
  let c = new Date(Date.UTC(year, month, dom, spec.hour, 0, 0, 0));
  if (c <= local) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    c = new Date(Date.UTC(year, month, dom, spec.hour, 0, 0, 0));
  }
  return toUtcIso(c, offset);
}

function toUtcIso(localDate: Date, offsetMinutes: number): string {
  return new Date(localDate.getTime() - offsetMinutes * 60_000).toISOString();
}
