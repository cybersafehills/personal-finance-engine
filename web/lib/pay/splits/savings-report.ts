// The Save On savings report: what the person saved in transfer fees by sending in
// parts. PURE (no I/O, no framework imports), so it is `deno test`-able and shared by the
// web pages and the mobile API. The numbers come from public.save_on_report(), which only
// counts a plan once every part is settled; these helpers never add to them.
//
// Money is carried as digit strings (bigint-safe). Figures are ESTIMATES from the provider's
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

export function isSavingsPeriod(v: unknown): v is SavingsPeriodKey {
  return SAVINGS_PERIODS.some((p) => p.key === v);
}

export type SavingsPeriod = {
  key: SavingsPeriodKey;
  /** What Save On saved: the fee as one transfer minus the fee as parts. */
  savedMinor: string;
  /** What those transfers would have cost sent as one each. */
  wouldHavePaidMinor: string;
  /** What they cost sent in parts. */
  paidMinor: string;
  plans: number;
  transfers: number;
};

export type SavingsReport = {
  generatedAt: string;
  currency: "RWF";
  /** Always every window in SAVINGS_PERIODS order. */
  periods: SavingsPeriod[];
  /** Plans still being sent: not counted above, shown as what is expected once they finish. */
  inProgress: { plans: number; expectedSavingMinor: string };
  recent: { planId: string; completedAt: string; totalMinor: string; savedMinor: string; transfers: number }[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const money = (v: unknown): string | null => {
  const s = typeof v === "number" ? (Number.isSafeInteger(v) ? String(v) : "") : typeof v === "string" ? v : "";
  return /^\d{1,18}$/.test(s) ? s : null;
};
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** Reads the RPC's JSON strictly: anything missing or malformed is no report, never a guessed zero. */
export function parseSavingsReport(raw: unknown): SavingsReport | null {
  if (!isRecord(raw) || typeof raw.generated_at !== "string" || !Array.isArray(raw.periods)) return null;
  const periods: SavingsPeriod[] = [];
  for (const def of SAVINGS_PERIODS) {
    const p = raw.periods.find((x) => isRecord(x) && x.key === def.key);
    if (!isRecord(p)) return null;
    const saved = money(p.saved_minor), would = money(p.would_have_paid_minor), paid = money(p.paid_minor);
    const plans = count(p.plans), transfers = count(p.transfers);
    if (saved === null || would === null || paid === null || plans === null || transfers === null) return null;
    periods.push({ key: def.key, savedMinor: saved, wouldHavePaidMinor: would, paidMinor: paid, plans, transfers });
  }
  const ip = raw.in_progress;
  if (!isRecord(ip)) return null;
  const ipPlans = count(ip.plans), ipExpected = money(ip.expected_saving_minor);
  if (ipPlans === null || ipExpected === null) return null;
  const recent: SavingsReport["recent"] = [];
  for (const r of Array.isArray(raw.recent) ? raw.recent : []) {
    if (!isRecord(r) || typeof r.plan_id !== "string" || typeof r.completed_at !== "string") continue;
    const total = money(r.total_minor), saved = money(r.saved_minor), transfers = count(r.transfers);
    if (total === null || saved === null || transfers === null) continue;
    recent.push({ planId: r.plan_id, completedAt: r.completed_at, totalMinor: total, savedMinor: saved, transfers });
  }
  return {
    generatedAt: raw.generated_at,
    currency: "RWF",
    periods,
    inProgress: { plans: ipPlans, expectedSavingMinor: ipExpected },
    recent,
  };
}

export function periodOf(report: SavingsReport, key: SavingsPeriodKey): SavingsPeriod {
  // parseSavingsReport guarantees every window is present.
  return report.periods.find((p) => p.key === key) as SavingsPeriod;
}

/** True once Save On has saved anything at all, or has a plan still being sent. */
export function hasSavingsActivity(report: SavingsReport): boolean {
  return periodOf(report, "all").plans > 0 || report.inProgress.plans > 0;
}

/** Whole-percent share of the one-transfer fees that were saved, or null when there were none. */
export function savedPercent(p: Pick<SavingsPeriod, "savedMinor" | "wouldHavePaidMinor">): number | null {
  const would = BigInt(p.wouldHavePaidMinor);
  if (would === 0n) return null;
  return Number((BigInt(p.savedMinor) * 100n) / would);
}
