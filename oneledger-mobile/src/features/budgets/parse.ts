import { failureForStatus, type BearerFailure } from "@/api/bearer";

import type { AllocationStatus, Budget, BudgetAlert, BudgetAllocation } from "./types";

const STATUSES: readonly AllocationStatus[] = [
  "healthy",
  "watch",
  "at_risk",
  "exceeded",
  "insufficient_data",
];
const SEVERITIES = ["info", "warning", "critical"] as const;
const CURRENCIES = ["RWF", "EUR", "USD"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (num(v) ? v : null);
const countOf = (v: unknown): number => (num(v) && v > 0 ? v : 0);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function parseAllocation(raw: unknown): BudgetAllocation | null {
  if (!isRecord(raw)) return null;
  if (!str(raw.type) || !str(raw.label)) return null;
  if (!STATUSES.includes(raw.status as AllocationStatus)) return null;
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

function parseAlert(raw: unknown): BudgetAlert | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.message)) return null;
  if (!SEVERITIES.includes(raw.severity as (typeof SEVERITIES)[number])) return null;
  return { id: raw.id, severity: raw.severity as BudgetAlert["severity"], message: raw.message };
}

function parseBudget(raw: unknown): Budget | null {
  if (!isRecord(raw)) return null;
  const { id, name, currency, periodStart, periodEnd } = raw;
  if (!str(id) || !str(name)) return null;
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) return null;
  if (!str(periodStart) || !DATE_KEY.test(periodStart)) return null;
  if (!str(periodEnd) || !DATE_KEY.test(periodEnd)) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    id,
    name,
    currency: currency as Budget["currency"],
    periodStart,
    periodEnd,
    elapsedFraction: num(raw.elapsedFraction) ? Math.min(1, Math.max(0, raw.elapsedFraction)) : null,
    actualIncomeMinor: num(raw.actualIncomeMinor) ? raw.actualIncomeMinor : 0,
    allocations: list(raw.allocations)
      .map(parseAllocation)
      .filter((a): a is BudgetAllocation => a !== null),
    alerts: list(raw.alerts)
      .map(parseAlert)
      .filter((a): a is BudgetAlert => a !== null),
    uncategorizedCount: countOf(raw.uncategorizedCount),
    uncategorizedMinor: countOf(raw.uncategorizedMinor),
    unmappedCount: countOf(raw.unmappedCount),
    unmappedMinor: countOf(raw.unmappedMinor),
  };
}

export type BudgetsResult = ({ ok: true; budgets: Budget[] } | ({ ok: false } & BearerFailure));

/** Maps the endpoint's HTTP status and JSON to a typed result. */
export function parseBudgetsResponse(status: number, body: unknown): BudgetsResult {
  if (status === 200 && isRecord(body) && body.ok === true && Array.isArray(body.budgets)) {
    return {
      ok: true,
      budgets: body.budgets.map(parseBudget).filter((b): b is Budget => b !== null),
    };
  }
  if (status === 200) {
    return { ok: false, reason: "error", message: "The budgets response wasn't understood." };
  }
  return { ok: false, ...failureForStatus(status, "Your budget") };
}
