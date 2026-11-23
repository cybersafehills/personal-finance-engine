import { bearerGet, failureForOutcome, failureForStatus, type BearerFailure } from "@/api/bearer";

import { minor } from "./parse";

// GET /api/mobile/insights/intelligence (docs/mobile-api.md): the non-forecast
// facts behind the web's Home "Insights" card - spending vs. your usual pace,
// unusually large payments, detected recurring payments and the one-line
// summary. Amounts arrive as decimal strings and are held as bigint. A payload
// that doesn't add up is refused whole, never half-shown.

export type Baseline = {
  thisMonth: bigint;
  usual: bigint;
  changePercent: number;
  direction: "above" | "below" | "in_line";
  monthsCompared: number;
  basis: string[];
};

export type UnusualPayment = {
  counterparty: string;
  category: string | null;
  amount: bigint;
  typical: bigint;
  timesTypical: number;
  occurredAt: string;
};

export type RecurringPayment = {
  counterparty: string;
  category: string | null;
  typicalAmount: bigint;
  typicalDay: number;
  monthsSeen: number;
};

export type Intelligence = {
  computedAt: string;
  defaultWalletId: string | null;
  summary: { headline: string; body: string } | null;
  baseline: Baseline | null;
  anomalies: UnusualPayment[];
  anomaliesTotal: number;
  recurring: RecurringPayment[];
  recurringTotal: number;
};

export type IntelligenceResult = ({ ok: true } & Intelligence) | ({ ok: false } & BearerFailure);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);

function parseBaseline(raw: unknown): Baseline | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const thisMonth = minor(raw.this_month_minor);
  const usual = minor(raw.usual_minor);
  if (
    thisMonth === null || usual === null || thisMonth < 0n || usual < 0n ||
    typeof raw.change_percent !== "number" || !Number.isInteger(raw.change_percent) ||
    (raw.direction !== "above" && raw.direction !== "below" && raw.direction !== "in_line") ||
    !isCount(raw.months_compared) || !Array.isArray(raw.basis) || !raw.basis.every(isText)
  ) return undefined;
  return {
    thisMonth, usual, changePercent: raw.change_percent, direction: raw.direction,
    monthsCompared: raw.months_compared, basis: raw.basis,
  };
}

function parseAnomaly(raw: unknown): UnusualPayment | null {
  if (!isRecord(raw)) return null;
  const amount = minor(raw.amount_minor);
  const typical = minor(raw.typical_minor);
  if (
    !isText(raw.counterparty) || !isTextOrNull(raw.category) || amount === null || typical === null ||
    amount <= 0n || typical <= 0n || typeof raw.times_typical !== "number" || !(raw.times_typical > 0) ||
    !isInstant(raw.occurred_at)
  ) return null;
  return {
    counterparty: raw.counterparty, category: raw.category, amount, typical,
    timesTypical: raw.times_typical, occurredAt: raw.occurred_at,
  };
}

function parseRecurring(raw: unknown): RecurringPayment | null {
  if (!isRecord(raw)) return null;
  const typicalAmount = minor(raw.typical_amount_minor);
  if (
    !isText(raw.counterparty) || !isTextOrNull(raw.category) || typicalAmount === null || typicalAmount <= 0n ||
    typeof raw.typical_day !== "number" || !Number.isInteger(raw.typical_day) || raw.typical_day < 1 || raw.typical_day > 31 ||
    !isCount(raw.months_seen)
  ) return null;
  return {
    counterparty: raw.counterparty, category: raw.category, typicalAmount,
    typicalDay: raw.typical_day, monthsSeen: raw.months_seen,
  };
}

const UNVERIFIED: IntelligenceResult = { ok: false, reason: "error", message: "Couldn’t verify your insights for this Space." };

export function parseIntelligence(status: number, body: unknown, workspaceId?: string | null): IntelligenceResult {
  if (status === 422) {
    return { ok: false, reason: "error", message: "There’s too much activity to summarise your insights right now." };
  }
  if (status !== 200) return { ok: false, ...failureForStatus(status, "Your insights") };
  if (
    !isRecord(body) || body.ok !== true || !isInstant(body.computed_at) ||
    (workspaceId && body.workspace_id !== workspaceId) ||
    !(body.default_wallet_id === null || isText(body.default_wallet_id)) ||
    !isCount(body.anomalies_total) || !isCount(body.recurring_total) ||
    !Array.isArray(body.anomalies) || !Array.isArray(body.recurring)
  ) return UNVERIFIED;

  let summary: Intelligence["summary"] = null;
  if (body.summary !== null) {
    if (!isRecord(body.summary) || !isText(body.summary.headline) || !isText(body.summary.body)) return UNVERIFIED;
    summary = { headline: body.summary.headline, body: body.summary.body };
  }
  const baseline = parseBaseline(body.baseline);
  if (baseline === undefined) return UNVERIFIED;

  const anomalies = body.anomalies.map(parseAnomaly);
  const recurring = body.recurring.map(parseRecurring);
  if (anomalies.some((a) => a === null) || recurring.some((r) => r === null)) return UNVERIFIED;
  if (body.anomalies_total < anomalies.length || body.recurring_total < recurring.length) return UNVERIFIED;

  return {
    ok: true,
    computedAt: body.computed_at,
    defaultWalletId: body.default_wallet_id,
    summary,
    baseline,
    anomalies: anomalies as UnusualPayment[],
    anomaliesTotal: body.anomalies_total,
    recurring: recurring as RecurringPayment[],
    recurringTotal: body.recurring_total,
  };
}

export async function fetchIntelligence(workspaceId?: string | null): Promise<IntelligenceResult> {
  const result = await bearerGet("/api/mobile/insights/intelligence");
  return result.kind === "response"
    ? parseIntelligence(result.status, result.body, workspaceId)
    : { ok: false, ...failureForOutcome(result, "Your insights") };
}
