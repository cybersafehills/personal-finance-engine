import "server-only";
import { supabaseSession } from "./supabase-session-server";
import { supabaseServer } from "./supabase-server";
import { getActiveWorkspace } from "./queries";
import { isValidReportTimezone } from "./timezones";
import { nextMonthlyRunUtc, resolveStatementPeriod } from "./statement-period";
import {
  buildPendingStatementRecord,
  resolveStatementScope,
  type StatementFilters,
} from "./statement-snapshot";
import {
  getStatementFormOptions,
  recordStatementAudit,
} from "./statement-generation";
import { generateStatementId, generateVerificationToken } from "./statement-id";

// Scheduled Statements (master prompt section 30). A schedule is a plain
// config row; members manage their own through RLS. The cron tick
// (run-statement-schedules) enqueues a status='generating' statements stub
// per due schedule and advances next_run_at - the statement-jobs worker
// finalizes it. The generated statement just appears in history;
// email/notification delivery is deferred.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StatementScheduleRow = {
  id: string;
  statement_type: "standard" | "detailed";
  account_ids: string[];
  filters: StatementFilters | null;
  day_of_month: number;
  timezone: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
};

export async function getStatementSchedules(): Promise<StatementScheduleRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("statement_schedules")
    .select(
      "id, statement_type, account_ids, filters, day_of_month, timezone, enabled, last_run_at, next_run_at, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getStatementSchedules failed:", error.message);
    return [];
  }
  return (data ?? []) as StatementScheduleRow[];
}

export type SaveScheduleOutcome =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function saveStatementSchedule(input: {
  statementType: "standard" | "detailed";
  sourceIds: string[];
  dayOfMonth: number;
  timezone: string;
}): Promise<SaveScheduleOutcome> {
  if (
    input.statementType !== "standard" && input.statementType !== "detailed"
  ) {
    return { ok: false, error: "Unknown statement type." };
  }
  if (
    !Number.isInteger(input.dayOfMonth) ||
    input.dayOfMonth < 1 || input.dayOfMonth > 28
  ) {
    return { ok: false, error: "Day of month must be between 1 and 28." };
  }
  if (!isValidReportTimezone(input.timezone)) {
    return { ok: false, error: "Unrecognized timezone." };
  }
  const ids = Array.from(new Set((input.sourceIds ?? []).filter(Boolean)));
  if (ids.length > 100 || !ids.every((id) => UUID_RE.test(id))) {
    return { ok: false, error: "An account reference was malformed." };
  }

  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return { ok: false, error: "We couldn't determine your workspace." };
  }
  if (workspace.role === "viewer") {
    return { ok: false, error: "Viewers can't schedule statements." };
  }

  // Authorize the requested sources against the same set createStatement
  // would accept.
  const opts = await getStatementFormOptions();
  if (!opts.ok) return { ok: false, error: "We couldn't load your accounts." };
  const authorized = new Set(opts.sources.map((s) => s.id));
  if (!ids.every((id) => authorized.has(id))) {
    return {
      ok: false,
      error: "One or more selected accounts aren't available.",
    };
  }

  const nextRun = nextMonthlyRunUtc(
    input.dayOfMonth,
    input.timezone,
    new Date(),
  );

  const { data, error } = await supabase
    .from("statement_schedules")
    .insert({
      workspace_id: workspace.id,
      created_by: user.id,
      statement_type: input.statementType,
      account_ids: ids,
      day_of_month: input.dayOfMonth,
      timezone: input.timezone,
      enabled: true,
      next_run_at: nextRun.toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("saveStatementSchedule failed:", error?.message);
    return { ok: false, error: "Could not save the schedule." };
  }
  return { ok: true, id: data.id };
}

export async function deleteStatementSchedule(
  scheduleId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!UUID_RE.test(scheduleId)) {
    return { ok: false, error: "Invalid schedule." };
  }
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("statement_schedules")
    .delete()
    .eq("id", scheduleId)
    .select("id");
  if (error) return { ok: false, error: "Could not delete the schedule." };
  if (!data || data.length === 0) return { ok: false, error: "Not found." };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cron tick (service role). NOT scheduled - matches generate-reports.
// ---------------------------------------------------------------------------

export type StatementScheduleTickSummary = {
  due: number;
  enqueued: number;
  errors: number;
  disabled?: true;
};

type DueSchedule = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  statement_type: "standard" | "detailed";
  account_ids: string[] | null;
  filters: StatementFilters | null;
  day_of_month: number;
  timezone: string;
};

async function enqueueScheduledStatement(
  service: ReturnType<typeof supabaseServer>,
  schedule: DueSchedule,
  now: Date,
): Promise<boolean> {
  const periodRes = resolveStatementPeriod({
    preset: "last_month",
    timezone: schedule.timezone,
    now,
  });
  if (!periodRes.ok) {
    console.error(
      "statement schedule: bad period",
      schedule.id,
      periodRes.error,
    );
    return false;
  }
  const period = periodRes.period;
  const accountIds = schedule.account_ids ?? [];
  const filters: StatementFilters = schedule.filters ?? {};
  const scopeRes = resolveStatementScope(accountIds, accountIds, filters);
  if (!scopeRes.ok) return false;

  let currencyHint = "RWF";
  if (accountIds.length > 0) {
    const { data } = await service
      .from("financial_sources")
      .select("currency")
      .in("id", accountIds);
    const currencies = Array.from(
      new Set(((data ?? []) as { currency: string }[]).map((r) => r.currency)),
    );
    if (currencies.length === 1) currencyHint = currencies[0];
  }

  const record = buildPendingStatementRecord({
    statementPublicId: generateStatementId({ now }),
    workspaceId: schedule.workspace_id,
    createdBy: schedule.created_by ?? "",
    statementType: schedule.statement_type,
    scope: scopeRes.scope,
    accountIds: scopeRes.sourceIds,
    filters,
    periodStartUtc: period.periodStartUtc,
    periodEndUtc: period.periodEndUtc,
    timezone: schedule.timezone,
    currencyHint,
    supersedesId: null,
    clientToken: crypto.randomUUID(),
    verificationToken: generateVerificationToken(),
  });

  const { data, error } = await service
    .from("statements")
    .insert(record)
    .select("id")
    .single();
  if (error || !data) {
    console.error(
      "statement schedule: enqueue failed",
      schedule.id,
      error?.message,
    );
    return false;
  }

  if (schedule.created_by) {
    await recordStatementAudit(service, {
      workspaceId: schedule.workspace_id,
      actorUserId: schedule.created_by,
      eventType: "statement.generated",
      statementUuid: data.id,
      metadata: { scheduleId: schedule.id, scheduled: true, async: true },
    });
  }
  return true;
}

export async function runStatementScheduleTick(
  now: Date = new Date(),
): Promise<StatementScheduleTickSummary> {
  if (process.env.FINANCIAL_STATEMENTS_ENABLED !== "true") {
    return { due: 0, enqueued: 0, errors: 0, disabled: true };
  }
  const service = supabaseServer();
  const { data, error } = await service
    .from("statement_schedules")
    .select(
      "id, workspace_id, created_by, statement_type, account_ids, filters, day_of_month, timezone",
    )
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .limit(100);

  if (error) {
    console.error("runStatementScheduleTick: list failed:", error.message);
    return { due: 0, enqueued: 0, errors: 0 };
  }
  const due = (data ?? []) as DueSchedule[];
  let enqueued = 0;
  let errors = 0;
  for (const schedule of due) {
    const ok = await enqueueScheduledStatement(service, schedule, now);
    if (ok) enqueued += 1;
    else errors += 1;
    // Always advance so a failing schedule does not re-fire every tick.
    await service
      .from("statement_schedules")
      .update({
        last_run_at: now.toISOString(),
        next_run_at: nextMonthlyRunUtc(
          schedule.day_of_month,
          schedule.timezone,
          now,
        )
          .toISOString(),
      })
      .eq("id", schedule.id);
  }
  return { due: due.length, enqueued, errors };
}
