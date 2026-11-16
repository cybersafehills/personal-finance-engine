import { failureForStatus, type BearerFailure } from "@/api/bearer";
import type { AllocationStatus, BudgetAllocation } from "@/features/budgets/types";

import type {
  Report,
  ReportAlert,
  ReportCategory,
  ReportListItem,
  ReportSnapshot,
  ReportTone,
  ReportTrend,
} from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (num(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const ALLOCATION_STATUSES: readonly AllocationStatus[] = [
  "healthy",
  "watch",
  "at_risk",
  "exceeded",
  "insufficient_data",
];
const TONES: readonly ReportTone[] = ["positive", "negative", "neutral"];

function parseListItem(raw: unknown): ReportListItem | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.dateLabel) || !str(raw.status) || !str(raw.statusLabel)) return null;
  return {
    id: raw.id,
    dateLabel: raw.dateLabel,
    status: raw.status,
    statusLabel: raw.statusLabel,
    generatedLabel: str(raw.generatedLabel) ? raw.generatedLabel : null,
  };
}

function parseSnapshot(raw: unknown): ReportSnapshot | null {
  if (!isRecord(raw)) return null;
  if (!num(raw.netMovementRwf) || !num(raw.moneyReceivedRwf) || !num(raw.moneySpentRwf)) return null;
  if (!num(raw.feesRwf) || !num(raw.transactionCount)) return null;
  return {
    closingBalanceRwf: numOrNull(raw.closingBalanceRwf),
    netMovementRwf: raw.netMovementRwf,
    moneyReceivedRwf: raw.moneyReceivedRwf,
    moneySpentRwf: raw.moneySpentRwf,
    feesRwf: raw.feesRwf,
    transactionCount: raw.transactionCount,
    largestOutflowRwf: numOrNull(raw.largestOutflowRwf),
    largestInflowRwf: numOrNull(raw.largestInflowRwf),
  };
}

function parseCategory(raw: unknown): ReportCategory | null {
  if (!isRecord(raw) || !str(raw.category)) return null;
  if (!num(raw.amountRwf) || !num(raw.transactionCount) || !num(raw.percentOfSpending)) return null;
  return {
    category: raw.category,
    amountRwf: raw.amountRwf,
    transactionCount: raw.transactionCount,
    percentOfSpending: raw.percentOfSpending,
  };
}

function parseTrend(raw: unknown): ReportTrend | null {
  if (!isRecord(raw) || !str(raw.label) || !str(raw.valueLabel)) return null;
  if (!TONES.includes(raw.tone as ReportTone)) return null;
  return { label: raw.label, valueLabel: raw.valueLabel, changePercent: numOrNull(raw.changePercent), tone: raw.tone as ReportTone };
}

function parseAlert(raw: unknown): ReportAlert | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.message)) return null;
  return { id: raw.id, tone: raw.tone === "attention" ? "attention" : "neutral", message: raw.message };
}

function parseAllocation(raw: unknown): BudgetAllocation | null {
  if (!isRecord(raw) || !str(raw.type) || !str(raw.label)) return null;
  if (!ALLOCATION_STATUSES.includes(raw.status as AllocationStatus)) return null;
  if (!num(raw.targetMinor) || !num(raw.actualMinor) || !num(raw.remainingMinor)) return null;
  return {
    type: raw.type,
    label: raw.label,
    targetMinor: raw.targetMinor,
    actualMinor: raw.actualMinor,
    remainingMinor: raw.remainingMinor,
    percentConsumed: numOrNull(raw.percentConsumed),
    projectedMinor: numOrNull(raw.projectedMinor),
    status: raw.status as AllocationStatus,
  };
}

function parseReport(raw: unknown): Report | null {
  if (!isRecord(raw)) return null;
  if (!str(raw.id) || !str(raw.status) || !str(raw.statusLabel) || !str(raw.dateLabel)) return null;
  const forecast = isRecord(raw.forecast) && num(raw.forecast.projectedMonthEndSpendRwf) && str(raw.forecast.disclaimer)
    ? { projectedMonthEndSpendRwf: raw.forecast.projectedMonthEndSpendRwf, disclaimer: raw.forecast.disclaimer }
    : null;
  const insights = isRecord(raw.insights) && str(raw.insights.summary)
    ? {
        summary: raw.insights.summary,
        observations: list(raw.insights.observations).filter((o): o is string => typeof o === "string" && o.length > 0),
      }
    : null;
  const budget = isRecord(raw.budget)
    ? { allocations: list(raw.budget.allocations).map(parseAllocation).filter((a): a is BudgetAllocation => a !== null) }
    : null;
  return {
    id: raw.id,
    status: raw.status,
    statusLabel: raw.statusLabel,
    dateLabel: raw.dateLabel,
    timezone: str(raw.timezone) ? raw.timezone : "",
    generatedLabel: str(raw.generatedLabel) ? raw.generatedLabel : null,
    errorMessage: str(raw.errorMessage) ? raw.errorMessage : null,
    hasDocument: raw.hasDocument === true,
    snapshot: parseSnapshot(raw.snapshot),
    categories: list(raw.categories).map(parseCategory).filter((c): c is ReportCategory => c !== null),
    budget: budget && budget.allocations.length > 0 ? budget : null,
    trends: list(raw.trends).map(parseTrend).filter((t): t is ReportTrend => t !== null),
    alerts: list(raw.alerts).map(parseAlert).filter((a): a is ReportAlert => a !== null),
    forecast,
    insights,
  };
}

export type ReportsResult = { ok: true; reports: ReportListItem[] } | ({ ok: false } & BearerFailure);

export function parseReportsResponse(status: number, body: unknown): ReportsResult {
  if (status === 200 && isRecord(body) && body.ok === true && Array.isArray(body.reports)) {
    return { ok: true, reports: body.reports.map(parseListItem).filter((r): r is ReportListItem => r !== null) };
  }
  if (status === 200) return { ok: false, reason: "error", message: "The reports response wasn't understood." };
  return { ok: false, ...failureForStatus(status, "Your reports") };
}

export type ReportResult =
  | { ok: true; report: Report }
  | { ok: false; reason: "not_found" | "unavailable" | "unauthorized" | "mfa_required" | "error"; message: string };

export function parseReportResponse(status: number, body: unknown): ReportResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    if (body.report === null) return { ok: false, reason: "not_found", message: "That report couldn't be found." };
    const report = parseReport(body.report);
    if (report) return { ok: true, report };
    return { ok: false, reason: "error", message: "The report response wasn't understood." };
  }
  const f = failureForStatus(status, "That report");
  return { ok: false, reason: f.reason, message: f.message };
}

export type ReportDownloadResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_found" | "not_ready" | "unauthorized" | "mfa_required" | "unavailable" | "error"; message: string };

const DOWNLOAD_MESSAGES = {
  not_found: "That report couldn't be found.",
  not_ready: "That report hasn't been generated yet.",
  failed: "Couldn't prepare the PDF. Try again.",
} as const;

/** A download link is only ever accepted over https. */
export function parseReportDownloadResponse(status: number, body: unknown): ReportDownloadResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const d = body.download;
    if (isRecord(d) && str(d.url) && d.url.startsWith("https://")) return { ok: true, url: d.url };
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (reason === "not_found" || reason === "not_ready") {
      return { ok: false, reason, message: DOWNLOAD_MESSAGES[reason] };
    }
    return { ok: false, reason: "error", message: DOWNLOAD_MESSAGES.failed };
  }
  const f = failureForStatus(status, "That report");
  return { ok: false, reason: f.reason, message: f.message };
}
