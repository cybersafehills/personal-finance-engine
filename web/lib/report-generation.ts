import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "./supabase-server";
import {
  dailyReportPeriod,
  previousCompleteDayKey,
  zonedTimeOfDay,
} from "./report-period";
import {
  aggregateOutflowsByAllocation,
  AllocationStatus,
  AllocationType,
  BudgetAlert,
  computeAllocationActual,
  computeBudgetAlerts,
  computeElapsedFraction,
} from "./budget-math";
import {
  computeCategoryTotals,
  computeFinancialSnapshot,
  computeMonthEndForecast,
  computeReportAlerts,
  computeTrends,
  ReportAlertThresholds,
  ReportTransactionFact,
} from "./report-math";

// Phase D: idempotent, service-role report generation. This module is the
// ONLY place daily reports are actually assembled - everything here is
// server-only (never importable from client code) and every query is
// explicitly scoped by workspace_id/user_id read from a trusted internal
// row (report_preferences), never from client-submitted input (master
// prompt §14: a service-role connection bypasses RLS, so explicit scoping
// here IS the security boundary, not a redundant nicety).
//
// This module never recomputes accounting effects (supabase/functions/
// _shared/accounting.ts stays canonical) or budget-vs-actual math
// (budget-math.ts stays canonical) - it only fetches already-processed
// rows, explicitly scoped, and hands them to report-math.ts/budget-math.ts
// for calculation (master prompt §64).
//
// V1 alert thresholds are fixed module-level defaults, not yet a stored
// per-user preference - report_preferences (Phase B/J's migration) has no
// threshold columns today. Documented here as a deliberate, narrow scope
// cut: adding configurable thresholds is a additive follow-up migration,
// not a blocker for a correct V1 report.
const DEFAULT_ALERT_THRESHOLDS: ReportAlertThresholds = {
  largeTransactionRwf: 100_000,
  highDailySpendRwf: 200_000,
  elevatedFeesRwf: 5_000,
  lowBalanceRwf: 10_000,
  sustainedNegativeCashflowDays: 3,
  uncategorizedPercentThreshold: 50,
};

const ROLLING_AVERAGE_WINDOW_DAYS = 7;
const NEGATIVE_CASHFLOW_LOOKBACK_DAYS = 14;

type ServiceClient = SupabaseClient;

export type ReportPreferenceCandidate = {
  id: string;
  workspace_id: string;
  user_id: string;
  timezone: string;
  generation_time: string;
  delivery_email: string | null;
};

/**
 * report_preferences rows with daily_report_enabled = true - the full
 * due-work candidate set for the generation tick. Small table by
 * construction (one row per opted-in user), so a full scan here is
 * intentional and cheap (master prompt §45: avoid a unique cron job per
 * user, not avoid ever listing users).
 */
export async function getDailyReportCandidates(
  supabase: ServiceClient,
): Promise<ReportPreferenceCandidate[]> {
  const { data, error } = await supabase
    .from("report_preferences")
    .select(
      "id, workspace_id, user_id, timezone, generation_time, delivery_email",
    )
    .eq("daily_report_enabled", true);

  if (error) {
    throw new Error(`getDailyReportCandidates failed: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Whether `candidate`'s configured generation_time has already passed for
 * `nowInstant` in its own timezone. Deliberately has no upper bound (does
 * not stop being "due" later in the day) - generateDailyReportForCandidate
 * itself skips work cheaply once a report_runs row already exists for the
 * period, so a late/resumed cron tick correctly catches up a missed
 * generation instead of silently skipping it, and a report already
 * generated earlier today is never redone by a later tick.
 */
export function isGenerationDue(
  candidate: Pick<ReportPreferenceCandidate, "timezone" | "generation_time">,
  nowInstant: Date,
): boolean {
  return zonedTimeOfDay(nowInstant, candidate.timezone) >=
    candidate.generation_time;
}

type SettledTransactionRow = {
  id: string;
  direction: "in" | "out" | "neutral";
  principal_effect_rwf: number;
  fee_effect_rwf: number;
  category: string | null;
  counterparty_name: string | null;
  occurred_at: string;
};

const SETTLED_TRANSACTION_COLUMNS =
  "id, direction, principal_effect_rwf, fee_effect_rwf, category, counterparty_name, occurred_at";

async function fetchSettledTransactions(
  supabase: ServiceClient,
  workspaceId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<SettledTransactionRow[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select(SETTLED_TRANSACTION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("settlement_state", "settled")
    .gte("occurred_at", startUtc.toISOString())
    .lt("occurred_at", endUtc.toISOString());

  if (error) {
    throw new Error(`fetchSettledTransactions failed: ${error.message}`);
  }
  return data ?? [];
}

function toReportTransactionFacts(
  rows: SettledTransactionRow[],
): ReportTransactionFact[] {
  return rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    principalEffectRwf: Number(row.principal_effect_rwf),
    feeEffectRwf: Number(row.fee_effect_rwf),
    category: row.category,
    counterpartyName: row.counterparty_name,
    occurredAt: row.occurred_at,
  }));
}

/**
 * The canonical provider-reported balance as of `beforeUtc` (exclusive) -
 * the latest settled transaction's balance_after_rwf strictly before that
 * instant, or null when none exists yet (master prompt §31: never a
 * second running-balance algorithm computed here).
 */
async function fetchBalanceBefore(
  supabase: ServiceClient,
  workspaceId: string,
  beforeUtc: Date,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("transactions")
    .select("balance_after_rwf")
    .eq("workspace_id", workspaceId)
    .not("balance_after_rwf", "is", null)
    .lt("occurred_at", beforeUtc.toISOString())
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`fetchBalanceBefore failed: ${error.message}`);
  }
  return data?.balance_after_rwf ?? null;
}

type PriorReportPayload = {
  financialSnapshot: {
    moneySpentRwf: number;
    moneyReceivedRwf: number;
    feesRwf: number;
    transactionCount: number;
    netMovementRwf: number;
  };
};

async function fetchPriorReportPayloads(
  supabase: ServiceClient,
  workspaceId: string,
  userId: string,
  beforePeriodStart: Date,
  limit: number,
  sinceUtc?: Date,
): Promise<PriorReportPayload[]> {
  let query = supabase
    .from("report_runs")
    .select("report_payload")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("report_type", "daily")
    .eq("status", "generated")
    .lt("period_start", beforePeriodStart.toISOString())
    .order("period_start", { ascending: false })
    .limit(limit);

  if (sinceUtc) {
    query = query.gte("period_start", sinceUtc.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`fetchPriorReportPayloads failed: ${error.message}`);
  }
  return (data ?? [])
    .map((row) => row.report_payload as PriorReportPayload | null)
    .filter((payload): payload is PriorReportPayload => payload !== null);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Consecutive-day negative-net-movement streak, most recent day first,
 * INCLUDING today - walks back through prior reports only as long as
 * every immediately-preceding day (no gaps) also had negative net
 * movement. Bounded lookback (14 days) since this only needs to answer
 * "has it been at least N days" for a small configured N.
 */
async function computeConsecutiveNegativeDays(
  supabase: ServiceClient,
  workspaceId: string,
  userId: string,
  todayNetMovementRwf: number,
  periodStartUtc: Date,
): Promise<number> {
  if (todayNetMovementRwf >= 0) return 0;

  const priorPayloads = await fetchPriorReportPayloads(
    supabase,
    workspaceId,
    userId,
    periodStartUtc,
    NEGATIVE_CASHFLOW_LOOKBACK_DAYS,
  );

  let streak = 1;
  for (const payload of priorPayloads) {
    if (payload.financialSnapshot.netMovementRwf < 0) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

type ActiveBudgetRow = {
  id: string;
  currency: string;
  period_start: string;
  period_end: string;
  status: string;
  normalized_monthly_income_minor: number;
};

type BudgetAllocationRow = {
  allocation_type: AllocationType;
  target_amount_minor: number;
};

/** RWF only - see the Phase D budgets migration's own note on why live actuals only ever exist for RWF today. */
async function fetchActiveRwfBudget(
  supabase: ServiceClient,
  workspaceId: string,
): Promise<
  { budget: ActiveBudgetRow; allocations: BudgetAllocationRow[] } | null
> {
  const { data: budget, error: budgetError } = await supabase
    .from("budgets")
    .select(
      "id, currency, period_start, period_end, status, normalized_monthly_income_minor",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("currency", "RWF")
    .maybeSingle();

  if (budgetError) {
    throw new Error(`fetchActiveRwfBudget failed: ${budgetError.message}`);
  }
  if (!budget) return null;

  const { data: allocations, error: allocationsError } = await supabase
    .from("budget_allocations")
    .select("allocation_type, target_amount_minor")
    .eq("budget_id", budget.id);

  if (allocationsError) {
    throw new Error(
      `fetchActiveRwfBudget allocations failed: ${allocationsError.message}`,
    );
  }

  return { budget, allocations: allocations ?? [] };
}

// report_payload is stored as JSONB - every value reaching it must survive
// JSON.stringify (which throws on a raw `bigint`). budget-math.ts is
// deliberately bigint-based (currency-generic minor units), so its output
// is converted to plain `number` at this one boundary, immediately before
// it's embedded in the payload - RWF has zero decimal places, so this
// conversion is always exact for any realistic amount. This is the ONLY
// place that conversion happens; the math itself stays in budget-math.ts.

export type AllocationActualJson = {
  allocationType: AllocationType;
  targetMinor: number;
  actualMinor: number;
  remainingMinor: number;
  percentConsumed: number | null;
  projectedMinor: number | null;
  status: AllocationStatus;
};

function toAllocationActualJson(
  allocationType: AllocationType,
  actual: ReturnType<typeof computeAllocationActual>,
): AllocationActualJson {
  return {
    allocationType,
    targetMinor: Number(actual.targetMinor),
    actualMinor: Number(actual.actualMinor),
    remainingMinor: Number(actual.remainingMinor),
    percentConsumed: actual.percentConsumed,
    projectedMinor: actual.projectedMinor !== null ? Number(actual.projectedMinor) : null,
    status: actual.status,
  };
}

export type BudgetAlertJson =
  | { id: string; kind: "allocation_watch" | "allocation_at_risk"; severity: "info" | "warning"; allocationType: AllocationType; percentConsumed: number }
  | { id: string; kind: "allocation_exceeded"; severity: "critical"; allocationType: AllocationType; actualMinor: number; targetMinor: number }
  | { id: string; kind: "unmapped_spending" | "uncategorized_spending"; severity: "warning"; count: number; totalMinor: number }
  | { id: string; kind: "income_below_budget"; severity: "warning"; budgetedMinor: number; actualMinor: number; shortfallPercent: number };

function toBudgetAlertJson(alert: BudgetAlert): BudgetAlertJson {
  switch (alert.kind) {
    case "allocation_watch":
    case "allocation_at_risk":
      return alert;
    case "allocation_exceeded":
      return {
        ...alert,
        actualMinor: Number(alert.actualMinor),
        targetMinor: Number(alert.targetMinor),
      };
    case "unmapped_spending":
    case "uncategorized_spending":
      return { ...alert, totalMinor: Number(alert.totalMinor) };
    case "income_below_budget":
      return {
        ...alert,
        budgetedMinor: Number(alert.budgetedMinor),
        actualMinor: Number(alert.actualMinor),
      };
  }
}

export type BudgetSection = {
  budgetId: string;
  periodStart: string;
  periodEnd: string;
  overallStatus: AllocationStatus;
  allocations: AllocationActualJson[];
  alerts: BudgetAlertJson[];
} | { overallStatus: "no_active_budget" };

/** Worst-of ordering across allocation statuses, for the section's single overall status badge. */
function worstAllocationStatus(statuses: AllocationStatus[]): AllocationStatus {
  const severityOrder: AllocationStatus[] = [
    "exceeded",
    "at_risk",
    "watch",
    "healthy",
    "insufficient_data",
  ];
  for (const level of severityOrder) {
    if (statuses.includes(level)) return level;
  }
  return "insufficient_data";
}

async function computeBudgetSection(
  supabase: ServiceClient,
  workspaceId: string,
  transactions: SettledTransactionRow[],
  dateKey: string,
): Promise<BudgetSection> {
  const active = await fetchActiveRwfBudget(supabase, workspaceId);
  if (!active) return { overallStatus: "no_active_budget" };

  const { budget, allocations } = active;

  const { data: mappingsData, error: mappingsError } = await supabase
    .from("budget_category_mappings")
    .select("category, allocation_type, effective_from, effective_until")
    .eq("workspace_id", workspaceId);
  if (mappingsError) {
    throw new Error(
      `computeBudgetSection mappings failed: ${mappingsError.message}`,
    );
  }

  const transactionIds = transactions.map((t) => t.id);
  const splitsData = transactionIds.length > 0
    ? await (async () => {
      const { data, error } = await supabase
        .from("transaction_splits")
        .select("transaction_id, allocation_type, amount_minor")
        .in("transaction_id", transactionIds);
      if (error) {
        throw new Error(`computeBudgetSection splits failed: ${error.message}`);
      }
      return data;
    })()
    : [];

  const outflows = transactions
    .filter((t) => t.direction === "out")
    .map((t) => ({
      transactionId: t.id,
      category: t.category,
      effectMinor: BigInt(
        Math.abs(Number(t.principal_effect_rwf) + Number(t.fee_effect_rwf)),
      ),
      occurredAtDateKey: dateKey,
    }));

  const aggregation = aggregateOutflowsByAllocation(
    outflows,
    (splitsData ?? []).map((row) => ({
      transactionId: row.transaction_id,
      allocationType: row.allocation_type as AllocationType,
      amountMinor: BigInt(row.amount_minor),
    })),
    (mappingsData ?? []).map((row) => ({
      category: row.category,
      allocationType: row.allocation_type as AllocationType,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until,
    })),
  );

  const elapsedFraction = computeElapsedFraction(
    budget.period_start,
    budget.period_end,
    dateKey,
    budget.status === "active",
  );

  const allocationActuals = allocations.map((a) =>
    computeAllocationActual(
      aggregation.totalsByAllocation[a.allocation_type],
      BigInt(a.target_amount_minor),
      elapsedFraction,
    )
  );

  const incomingTotalMinor = transactions
    .filter((t) => t.direction === "in")
    .reduce(
      (sum, t) =>
        sum + Number(t.principal_effect_rwf) + Number(t.fee_effect_rwf),
      0,
    );

  const alerts = computeBudgetAlerts({
    allocations: allocations.map((a, i) => ({
      allocationType: a.allocation_type,
      actualMinor: aggregation.totalsByAllocation[a.allocation_type],
      targetMinor: BigInt(a.target_amount_minor),
      status: allocationActuals[i].status,
    })),
    unmappedCount: aggregation.unmappedCount,
    unmappedMinor: aggregation.unmappedMinor,
    uncategorizedCount: aggregation.uncategorizedCount,
    uncategorizedMinor: aggregation.uncategorizedMinor,
    budgetedIncomeMinor: BigInt(budget.normalized_monthly_income_minor),
    actualIncomeMinor: BigInt(incomingTotalMinor),
    elapsedFraction,
  });

  const allocationsJson = allocations.map((a, i) =>
    toAllocationActualJson(a.allocation_type, allocationActuals[i])
  );

  return {
    budgetId: budget.id,
    periodStart: budget.period_start,
    periodEnd: budget.period_end,
    overallStatus: worstAllocationStatus(allocationsJson.map((a) => a.status)),
    allocations: allocationsJson,
    alerts: alerts.map(toBudgetAlertJson),
  };
}

function daysInMonth(dateKey: string): number {
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayOfMonth(dateKey: string): number {
  return Number(dateKey.split("-")[2]);
}

export type GenerationOutcome =
  | { status: "generated"; reportRunId: string }
  | { status: "already_exists"; reportRunId: string }
  | { status: "no_data_needed" }
  | { status: "error"; message: string };

/**
 * Generates (or confirms already-generated) the daily report for one
 * candidate. Idempotent: a report_runs row already existing for this
 * (workspace, user, 'daily', period_start) short-circuits before any
 * further fetching - both because it's the correct behavior and because
 * it makes repeated ticks after the first successful generation in a day
 * cheap. The actual insert additionally relies on
 * report_runs_unique_period (a database-level unique constraint) for
 * concurrent-worker safety - this existence check is an optimization, not
 * the safety mechanism itself.
 */
export async function generateDailyReportForCandidate(
  supabase: ServiceClient,
  candidate: ReportPreferenceCandidate,
  nowInstant: Date,
): Promise<GenerationOutcome> {
  try {
    const dateKey = previousCompleteDayKey(nowInstant, candidate.timezone);
    const { periodStartUtc, periodEndUtc } = dailyReportPeriod(
      dateKey,
      candidate.timezone,
    );

    const { data: existing, error: existingError } = await supabase
      .from("report_runs")
      .select("id")
      .eq("workspace_id", candidate.workspace_id)
      .eq("user_id", candidate.user_id)
      .eq("report_type", "daily")
      .eq("period_start", periodStartUtc.toISOString())
      .maybeSingle();
    if (existingError) {
      throw new Error(`existence check failed: ${existingError.message}`);
    }
    if (existing) {
      return { status: "already_exists", reportRunId: existing.id };
    }

    const [
      rawTransactions,
      openingBalanceRwf,
      closingBalanceRwf,
      priorPayloads,
    ] = await Promise.all([
      fetchSettledTransactions(
        supabase,
        candidate.workspace_id,
        periodStartUtc,
        periodEndUtc,
      ),
      fetchBalanceBefore(supabase, candidate.workspace_id, periodStartUtc),
      fetchBalanceBefore(supabase, candidate.workspace_id, periodEndUtc),
      fetchPriorReportPayloads(
        supabase,
        candidate.workspace_id,
        candidate.user_id,
        periodStartUtc,
        ROLLING_AVERAGE_WINDOW_DAYS,
      ),
    ]);

    const transactions = toReportTransactionFacts(rawTransactions);
    const snapshot = computeFinancialSnapshot(
      transactions,
      openingBalanceRwf,
      closingBalanceRwf,
    );
    const categoryTotals = computeCategoryTotals(transactions);

    const trends = computeTrends({
      todaySpentRwf: snapshot.moneySpentRwf,
      rolling7DayAvgSpentRwf: average(
        priorPayloads.map((p) => p.financialSnapshot.moneySpentRwf),
      ),
      todayReceivedRwf: snapshot.moneyReceivedRwf,
      rolling7DayAvgReceivedRwf: average(
        priorPayloads.map((p) => p.financialSnapshot.moneyReceivedRwf),
      ),
      todayFeesRwf: snapshot.feesRwf,
      rolling7DayAvgFeesRwf: average(
        priorPayloads.map((p) => p.financialSnapshot.feesRwf),
      ),
      todayTransactionCount: snapshot.transactionCount,
      rolling7DayAvgTransactionCount: average(
        priorPayloads.map((p) => p.financialSnapshot.transactionCount),
      ),
    });

    const consecutiveNegativeDays = await computeConsecutiveNegativeDays(
      supabase,
      candidate.workspace_id,
      candidate.user_id,
      snapshot.netMovementRwf,
      periodStartUtc,
    );

    const alerts = computeReportAlerts({
      transactions,
      snapshot,
      consecutiveNegativeDays,
      thresholds: DEFAULT_ALERT_THRESHOLDS,
    });

    const budgetSection = await computeBudgetSection(
      supabase,
      candidate.workspace_id,
      rawTransactions,
      dateKey,
    );

    // Month-to-date spend for the forecast: sum of moneySpentRwf across
    // this report plus every prior report this month, from already-
    // persisted snapshots rather than a fresh raw-transaction query -
    // reports are their own natural cache for historical aggregates
    // (master prompt §43).
    const monthStartDateKey = `${dateKey.slice(0, 7)}-01`;
    const { periodStartUtc: monthStartUtc } = dailyReportPeriod(
      monthStartDateKey,
      candidate.timezone,
    );
    const monthPriorPayloads = await fetchPriorReportPayloads(
      supabase,
      candidate.workspace_id,
      candidate.user_id,
      periodStartUtc,
      31,
      monthStartUtc,
    );
    const monthToDateSpentRwf = monthPriorPayloads.reduce(
      (sum, p) => sum + p.financialSnapshot.moneySpentRwf,
      0,
    ) + snapshot.moneySpentRwf;

    const forecast = computeMonthEndForecast(
      monthToDateSpentRwf,
      dayOfMonth(dateKey),
      daysInMonth(dateKey),
    );

    const reportPayload = {
      schemaVersion: 1,
      dateKey,
      timezone: candidate.timezone,
      financialSnapshot: snapshot,
      categoryTotals,
      trends,
      alerts,
      budget: budgetSection,
      forecast,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("report_runs")
      .insert({
        workspace_id: candidate.workspace_id,
        user_id: candidate.user_id,
        report_type: "daily",
        period_start: periodStartUtc.toISOString(),
        period_end: periodEndUtc.toISOString(),
        timezone: candidate.timezone,
        status: "generated",
        scheduled_for: periodEndUtc.toISOString(),
        generation_started_at: new Date().toISOString(),
        generated_at: new Date().toISOString(),
        report_payload: reportPayload,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      // A unique-violation here means a concurrent tick/worker won the
      // race - not an error, the same outcome as "already_exists".
      if (insertError.code === "23505") {
        const { data: winner } = await supabase
          .from("report_runs")
          .select("id")
          .eq("workspace_id", candidate.workspace_id)
          .eq("user_id", candidate.user_id)
          .eq("report_type", "daily")
          .eq("period_start", periodStartUtc.toISOString())
          .maybeSingle();
        return { status: "already_exists", reportRunId: winner?.id ?? "" };
      }
      throw new Error(`insert failed: ${insertError.message}`);
    }

    return { status: "generated", reportRunId: inserted!.id };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type GenerationTickSummary = {
  candidatesEvaluated: number;
  generated: number;
  alreadyExists: number;
  errors: { candidateId: string; message: string }[];
};

/**
 * The generation tick's entry point - what the (future, not-yet-scheduled
 * per the Phase A rollout sequence) pg_cron-invoked route calls. Iterates
 * every opted-in candidate whose generation_time has passed and is not
 * yet generated for today; each candidate is independent, so one
 * candidate's failure never blocks the others'.
 */
export async function runDailyReportGenerationTick(
  nowInstant: Date = new Date(),
): Promise<GenerationTickSummary> {
  const supabase = supabaseServer();
  const candidates = await getDailyReportCandidates(supabase);
  const due = candidates.filter((c) => isGenerationDue(c, nowInstant));

  const summary: GenerationTickSummary = {
    candidatesEvaluated: due.length,
    generated: 0,
    alreadyExists: 0,
    errors: [],
  };

  for (const candidate of due) {
    const outcome = await generateDailyReportForCandidate(
      supabase,
      candidate,
      nowInstant,
    );
    if (outcome.status === "generated") summary.generated += 1;
    else if (outcome.status === "already_exists") summary.alreadyExists += 1;
    else if (outcome.status === "error") {
      summary.errors.push({
        candidateId: candidate.id,
        message: outcome.message,
      });
    }
  }

  return summary;
}
