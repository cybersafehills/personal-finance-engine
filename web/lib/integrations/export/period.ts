// Pure resolution of an export's date range. Relative presets are
// resolved at run time (so a "Monthly accountant export" template always
// means *last* month). All boundaries are UTC ISO strings; `to` is
// exclusive-ish end-of-day so callers use `occurred_at <= to`.

export const RELATIVE_PRESETS = [
  "last_30_days",
  "current_month",
  "previous_month",
  "current_week",
  "previous_week",
  "fiscal_year",
  "all",
] as const;
export type RelativePreset = (typeof RELATIVE_PRESETS)[number];

export type ExportPeriod =
  | { kind: "absolute"; from: string; to: string }
  | { kind: "relative"; preset: RelativePreset };

export type ResolvedPeriod = { from: string; to: string; label: string };

function iso(y: number, m: number, d: number, endOfDay = false): string {
  return new Date(Date.UTC(y, m, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0))
    .toISOString();
}

/** Monday-based week start for the UTC date of `ref`. */
function weekStart(ref: Date): Date {
  const day = ref.getUTCDay(); // 0 = Sun
  const delta = (day + 6) % 7; // days since Monday
  return new Date(Date.UTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    ref.getUTCDate() - delta,
  ));
}

export function resolvePeriod(period: ExportPeriod, now: Date): ResolvedPeriod {
  if (period.kind === "absolute") {
    return { from: period.from, to: period.to, label: "Custom range" };
  }

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  switch (period.preset) {
    case "last_30_days": {
      const from = new Date(now);
      from.setUTCDate(from.getUTCDate() - 30);
      return { from: from.toISOString(), to: now.toISOString(), label: "Last 30 days" };
    }
    case "current_month":
      return { from: iso(y, m, 1), to: now.toISOString(), label: "This month" };
    case "previous_month": {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      const lastDay = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
      return {
        from: iso(py, pm, 1),
        to: iso(py, pm, lastDay, true),
        label: "Last month",
      };
    }
    case "current_week": {
      const ws = weekStart(now);
      return { from: ws.toISOString(), to: now.toISOString(), label: "This week" };
    }
    case "previous_week": {
      const ws = weekStart(now);
      const from = new Date(ws);
      from.setUTCDate(from.getUTCDate() - 7);
      const to = new Date(ws);
      to.setUTCDate(to.getUTCDate() - 1);
      return {
        from: from.toISOString(),
        to: iso(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), true),
        label: "Last week",
      };
    }
    case "fiscal_year": {
      // Calendar year to date; a configurable fiscal start is future work.
      return { from: iso(y, 0, 1), to: now.toISOString(), label: `${y} to date` };
    }
    case "all":
      return {
        from: "1970-01-01T00:00:00.000Z",
        to: now.toISOString(),
        label: "All time",
      };
    default: {
      const _exhaustive: never = period.preset;
      void d;
      return _exhaustive;
    }
  }
}
