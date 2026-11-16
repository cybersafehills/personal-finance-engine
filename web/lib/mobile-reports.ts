// The report payloads for the mobile app (GET /api/mobile/reports and
// /api/mobile/reports/:id). Pure: reshapes a stored report run into plain JSON.
//
// A report is an immutable snapshot (report_runs.report_payload) that the web,
// the PDF and the morning email all render: they never recompute a financial
// fact, and neither does this. What the app cannot do for itself is the WORDING:
// alerts are sentences (shared with the email via report-alert-messages.ts), and
// dates are formatted in the report's own IANA timezone with toLocaleString,
// which a phone's JS engine may not support. So every sentence and date is
// rendered here, with the same functions the web uses, and the app only displays.

import { formatRwf, formatZonedDate, formatZonedDateTime } from "./format.ts";
import {
  allocationLabel,
  budgetAlertMessage,
  reportAlertMessage,
} from "./report-alert-messages.ts";
import type { AllocationStatus, AllocationType } from "./budget-math.ts";
import type { ReportAlertSeverity, TrendMetric } from "./report-math.ts";
import type { AiCommentaryPayload, ReportPayload } from "./report-types.ts";

export type ReportStatus =
  | "scheduled"
  | "generating"
  | "generated"
  | "generation_failed"
  | "delivery_pending"
  | "delivering"
  | "delivered"
  | "delivery_failed";

// Same wording as the web's status badge (components/ReportStatusBadge.tsx).
const STATUS_LABELS: Record<ReportStatus, string> = {
  scheduled: "Scheduled",
  generating: "Generating",
  generated: "Generated",
  generation_failed: "Generation failed",
  delivery_pending: "Delivery pending",
  delivering: "Sending",
  delivered: "Delivered",
  delivery_failed: "Delivery failed",
};

export type ReportSummaryInput = {
  id: string;
  period_start: string;
  timezone: string;
  status: string;
  generated_at: string | null;
};

export type ReportRunInput = ReportSummaryInput & {
  report_payload: ReportPayload | null;
  ai_payload: AiCommentaryPayload | null;
  error_message: string | null;
};

export type MobileReportListItem = {
  id: string;
  dateLabel: string;
  status: string;
  statusLabel: string;
  generatedLabel: string | null;
};

const isStatus = (s: string): s is ReportStatus => s in STATUS_LABELS;

/** A label for a timestamp the database says exists, or null if it can't be shown faithfully. */
function safeZoned(
  fn: (iso: string, tz: string) => string,
  iso: string,
  tz: string,
): string | null {
  try {
    const out = fn(iso, tz);
    return out.includes("Invalid") ? null : out;
  } catch {
    return null; // an unrecognised timezone: omit the label rather than show a wrong one
  }
}

export function toMobileReportListItem(
  run: ReportSummaryInput,
): MobileReportListItem | null {
  if (!isStatus(run.status)) return null;
  const dateLabel = safeZoned(formatZonedDate, run.period_start, run.timezone);
  if (!dateLabel) return null;
  return {
    id: run.id,
    dateLabel,
    status: run.status,
    statusLabel: STATUS_LABELS[run.status],
    generatedLabel: run.generated_at
      ? safeZoned(formatZonedDateTime, run.generated_at, run.timezone)
      : null,
  };
}

export type Tone = "positive" | "negative" | "neutral";

export type MobileTrend = {
  label: string;
  /** The current value as it should read ("1,200 RWF", or a plain count). */
  valueLabel: string;
  changePercent: number | null;
  /** Colour: spending/fees going up is unfavourable, income going up is favourable, a count is neutral. */
  tone: Tone;
};

export type MobileAllocation = {
  type: AllocationType;
  label: string;
  targetMinor: number;
  actualMinor: number;
  remainingMinor: number;
  percentConsumed: number | null;
  projectedMinor: number | null;
  status: AllocationStatus;
};

export type MobileReportAlert = {
  id: string;
  /** "attention" for warning/critical, else "neutral". */
  tone: "attention" | "neutral";
  message: string;
};

export type MobileReport = {
  id: string;
  status: string;
  statusLabel: string;
  dateLabel: string;
  timezone: string;
  generatedLabel: string | null;
  /** Why generation failed, when it did (capped). */
  errorMessage: string | null;
  /** A PDF can be made for it (only once a payload exists). */
  hasDocument: boolean;
  snapshot: {
    closingBalanceRwf: number | null;
    netMovementRwf: number;
    moneyReceivedRwf: number;
    moneySpentRwf: number;
    feesRwf: number;
    transactionCount: number;
    largestOutflowRwf: number | null;
    largestInflowRwf: number | null;
  } | null;
  categories: {
    category: string;
    amountRwf: number;
    transactionCount: number;
    percentOfSpending: number;
  }[];
  /** null = no active RWF budget for this period. */
  budget: { allocations: MobileAllocation[] } | null;
  trends: MobileTrend[];
  alerts: MobileReportAlert[];
  forecast: { projectedMonthEndSpendRwf: number; disclaimer: string } | null;
  insights: { summary: string; observations: string[] } | null;
};

/** Whether an INCREASE in this metric is good (true), bad (false) or neither (null). */
function increaseIsFavorable(metric: TrendMetric): boolean | null {
  if (metric === "income") return true;
  if (metric === "spend" || metric === "fees") return false;
  return null;
}

const alertTone = (
  severity: ReportAlertSeverity | "info" | "warning" | "critical",
): "attention" | "neutral" =>
  severity === "warning" || severity === "critical" ? "attention" : "neutral";

const MAX_ERROR_LENGTH = 300;

export function toMobileReport(run: ReportRunInput): MobileReport | null {
  if (!isStatus(run.status)) return null;
  const dateLabel = safeZoned(formatZonedDate, run.period_start, run.timezone);
  if (!dateLabel) return null;

  const payload = run.report_payload;
  const base = {
    id: run.id,
    status: run.status,
    statusLabel: STATUS_LABELS[run.status],
    dateLabel,
    timezone: run.timezone,
    generatedLabel: run.generated_at
      ? safeZoned(formatZonedDateTime, run.generated_at, run.timezone)
      : null,
    errorMessage: run.error_message
      ? run.error_message.slice(0, MAX_ERROR_LENGTH)
      : null,
    hasDocument: payload !== null,
  };

  if (!payload) {
    return {
      ...base,
      snapshot: null,
      categories: [],
      budget: null,
      trends: [],
      alerts: [],
      forecast: null,
      insights: null,
    };
  }

  const s = payload.financialSnapshot;
  const noBudget = payload.budget.overallStatus === "no_active_budget";
  const budget = "allocations" in payload.budget ? payload.budget : null;

  const trends: MobileTrend[] = payload.trends
    .filter((t) => t.comparisonValue !== null)
    .map((t) => {
      const favorable = increaseIsFavorable(t.metric);
      const increase = (t.changePercent ?? 0) > 0;
      const neutral = t.changePercent === null || favorable === null;
      return {
        label: t.label,
        valueLabel: t.metric === "transaction_count"
          ? `${Math.round(t.currentValue)}`
          : formatRwf(t.currentValue),
        changePercent: t.changePercent === null
          ? null
          : Math.round(t.changePercent),
        tone: neutral
          ? "neutral"
          : increase === favorable
          ? "positive"
          : "negative",
      };
    });

  return {
    ...base,
    snapshot: {
      closingBalanceRwf: s.closingBalanceRwf,
      netMovementRwf: s.netMovementRwf,
      moneyReceivedRwf: s.moneyReceivedRwf,
      moneySpentRwf: s.moneySpentRwf,
      feesRwf: s.feesRwf,
      transactionCount: s.transactionCount,
      largestOutflowRwf: s.largestOutflowRwf,
      largestInflowRwf: s.largestInflowRwf,
    },
    categories: payload.categoryTotals.map((c) => ({
      category: c.category,
      amountRwf: c.amountRwf,
      transactionCount: c.transactionCount,
      percentOfSpending: c.percentOfSpending,
    })),
    budget: noBudget || !budget ? null : {
      allocations: budget.allocations.map((a) => ({
        type: a.allocationType,
        label: allocationLabel(a.allocationType),
        targetMinor: a.targetMinor,
        actualMinor: a.actualMinor,
        remainingMinor: a.remainingMinor,
        percentConsumed: a.percentConsumed,
        projectedMinor: a.projectedMinor,
        status: a.status,
      })),
    },
    trends,
    alerts: [
      ...payload.alerts.map((a) => ({
        id: a.id,
        tone: alertTone(a.severity),
        message: reportAlertMessage(a),
      })),
      // Budget alerts only count when there is a budget (as on the web).
      ...(budget && !noBudget
        ? budget.alerts.map((a) => ({
          id: a.id,
          tone: alertTone(a.severity),
          message: budgetAlertMessage(a),
        }))
        : []),
    ],
    forecast: payload.forecast
      ? {
        projectedMonthEndSpendRwf: Math.round(
          payload.forecast.projectedMonthEndSpendRwf,
        ),
        disclaimer: payload.forecast.disclaimer,
      }
      : null,
    insights: run.ai_payload
      ? {
        summary: run.ai_payload.summary,
        observations: run.ai_payload.observations,
      }
      : null,
  };
}
