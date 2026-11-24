import { failureOf, type SaveOnResult } from "./parse";

// What Save On has saved in transfer fees (GET /api/mobile/pay/splits/savings). The
// server counts a saving only once every part of a plan has gone through; the app only
// shows it. Money is carried as digit strings. Figures are estimates from the provider's
// published fee table: the provider shows the final fee.

export const SAVINGS_PERIODS = [
  { key: "24h", label: "Last 24 hours" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 2 weeks" },
  { key: "30d", label: "Last month" },
  { key: "90d", label: "Last 3 months" },
  { key: "365d", label: "Last 12 months" },
  { key: "all", label: "All time" },
] as const;

export type SavingsPeriodKey = (typeof SAVINGS_PERIODS)[number]["key"];
export const DEFAULT_SAVINGS_PERIOD: SavingsPeriodKey = "30d";

export type SavingsPeriod = {
  key: SavingsPeriodKey;
  savedMinor: string;
  wouldHavePaidMinor: string;
  paidMinor: string;
  plans: number;
  transfers: number;
};

export type SaveOnSavings = {
  periods: SavingsPeriod[];
  inProgress: { plans: number; expectedSavingMinor: string };
  recent: { planId: string; completedAt: string; totalMinor: string; savedMinor: string; transfers: number }[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const digits = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Strict: a report missing a window or with a bad figure is no report, never a guessed zero. */
export function parseSavings(raw: unknown): SaveOnSavings | null {
  if (!isRecord(raw) || !Array.isArray(raw.periods) || !isRecord(raw.inProgress)) return null;
  const periods: SavingsPeriod[] = [];
  for (const def of SAVINGS_PERIODS) {
    const p = raw.periods.find((x) => isRecord(x) && x.key === def.key);
    if (!isRecord(p)) return null;
    if (!digits(p.savedMinor) || !digits(p.wouldHavePaidMinor) || !digits(p.paidMinor) || !count(p.plans) || !count(p.transfers)) return null;
    periods.push({ key: def.key, savedMinor: p.savedMinor, wouldHavePaidMinor: p.wouldHavePaidMinor, paidMinor: p.paidMinor, plans: p.plans, transfers: p.transfers });
  }
  const ip = raw.inProgress;
  if (!count(ip.plans) || !digits(ip.expectedSavingMinor)) return null;
  const recent: SaveOnSavings["recent"] = [];
  for (const r of Array.isArray(raw.recent) ? raw.recent : []) {
    if (!isRecord(r) || typeof r.planId !== "string" || typeof r.completedAt !== "string") continue;
    if (!digits(r.totalMinor) || !digits(r.savedMinor) || !count(r.transfers)) continue;
    recent.push({ planId: r.planId, completedAt: r.completedAt, totalMinor: r.totalMinor, savedMinor: r.savedMinor, transfers: r.transfers });
  }
  return { periods, inProgress: { plans: ip.plans, expectedSavingMinor: ip.expectedSavingMinor }, recent };
}

export function parseSavingsResponse(status: number, body: unknown): SaveOnResult<{ savings: SaveOnSavings }> {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const savings = parseSavings(body.report);
    if (savings) return { ok: true, savings };
    return { ok: false, reason: "error", code: null, message: "The savings weren't understood." };
  }
  return failureOf(status, body, "Your savings");
}

export const periodOf = (s: SaveOnSavings, key: SavingsPeriodKey): SavingsPeriod => s.periods.find((p) => p.key === key) as SavingsPeriod;

export const hasSavingsActivity = (s: SaveOnSavings): boolean => periodOf(s, "all").plans > 0 || s.inProgress.plans > 0;

/** Whole-percent share of the one-transfer fees that was saved, or null when there were none. */
export function savedPercent(p: Pick<SavingsPeriod, "savedMinor" | "wouldHavePaidMinor">): number | null {
  const would = BigInt(p.wouldHavePaidMinor);
  return would === 0n ? null : Number((BigInt(p.savedMinor) * 100n) / would);
}
