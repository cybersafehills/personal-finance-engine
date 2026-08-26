import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "./supabase-server";
import {
  dailyReportPeriod,
  previousCompleteDayKey,
  zonedTimeOfDay,
} from "./report-period";
import { siteUrl } from "./site-url";
import { sendDailyReportEmail } from "./emails";
import {
  allocationLabel,
  budgetAlertMessage,
  reportAlertMessage,
} from "./report-alert-messages";
import type { ReportPayload } from "./report-types";

// Phase G: idempotent, service-role email delivery - deliberately
// separate from generation (report-generation.ts), matching report_runs/
// report_deliveries' own separation in the Phase B schema (master prompt
// §8/§9/§37: a report can exist successfully even when its delivery
// fails, and the two must never share one ambiguous status).
//
// This module never recalculates financial values - it only reads an
// already-generated report_runs.report_payload and hands pre-formatted
// strings/numbers to lib/emails.ts's renderer (master prompt §24).

type ServiceClient = SupabaseClient;

const MAX_DELIVERY_ATTEMPTS = 5;
const MIN_RETRY_INTERVAL_MS = 10 * 60 * 1000;

export type DeliveryCandidate = {
  id: string;
  workspace_id: string;
  user_id: string;
  timezone: string;
  delivery_time: string;
  delivery_email: string | null;
};

/** report_preferences rows with email_enabled = true - mirrors getDailyReportCandidates' "small table, full scan is fine" reasoning in report-generation.ts. */
export async function getEmailDeliveryCandidates(
  supabase: ServiceClient,
): Promise<DeliveryCandidate[]> {
  const { data, error } = await supabase
    .from("report_preferences")
    .select(
      "id, workspace_id, user_id, timezone, delivery_time, delivery_email",
    )
    .eq("email_enabled", true);

  if (error) {
    throw new Error(`getEmailDeliveryCandidates failed: ${error.message}`);
  }
  return data ?? [];
}

export function isDeliveryDue(
  candidate: Pick<DeliveryCandidate, "timezone" | "delivery_time">,
  nowInstant: Date,
): boolean {
  return zonedTimeOfDay(nowInstant, candidate.timezone) >=
    candidate.delivery_time;
}

function formatDateKeyLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildBudgetSummaryLines(budget: ReportPayload["budget"]): string[] {
  if (budget.overallStatus === "no_active_budget") return [];
  return budget.allocations.map((allocation) => {
    const percent = allocation.percentConsumed !== null
      ? `${Math.round(allocation.percentConsumed)}% of target used`
      : "no target consumption to report";
    return `${allocationLabel(allocation.allocationType)}: ${percent}.`;
  });
}

function buildWatchOutLines(payload: ReportPayload): string[] {
  const budgetAlerts = payload.budget.overallStatus === "no_active_budget"
    ? []
    : payload.budget.alerts;
  return [
    ...payload.alerts.map(reportAlertMessage),
    ...budgetAlerts.map(budgetAlertMessage),
  ];
}

export type DeliveryOutcome =
  | { status: "delivered" }
  | { status: "already_delivered" }
  | { status: "report_not_ready" }
  | { status: "no_destination" }
  | { status: "max_attempts_reached" }
  | { status: "retry_backoff" }
  | { status: "delivery_failed"; errorCode: string }
  | { status: "error"; message: string };

/**
 * Delivers (or confirms already-delivered) the daily report email for one
 * candidate. Idempotent the same way generation is: an existence check
 * against report_deliveries short-circuits a delivered row before
 * anything else, and report_deliveries_unique_send (a database-level
 * unique constraint) backstops concurrent-worker safety.
 */
export async function deliverReportForCandidate(
  supabase: ServiceClient,
  candidate: DeliveryCandidate,
  nowInstant: Date,
): Promise<DeliveryOutcome> {
  try {
    const destination = candidate.delivery_email;
    if (!destination) return { status: "no_destination" };

    const dateKey = previousCompleteDayKey(nowInstant, candidate.timezone);
    const { periodStartUtc } = dailyReportPeriod(dateKey, candidate.timezone);

    const { data: reportRun, error: reportRunError } = await supabase
      .from("report_runs")
      .select("id, status, report_payload")
      .eq("workspace_id", candidate.workspace_id)
      .eq("user_id", candidate.user_id)
      .eq("report_type", "daily")
      .eq("period_start", periodStartUtc.toISOString())
      .maybeSingle();

    if (reportRunError) {
      throw new Error(`report_runs lookup failed: ${reportRunError.message}`);
    }
    if (
      !reportRun || !reportRun.report_payload ||
      !["generated", "delivered", "delivery_failed"].includes(reportRun.status)
    ) {
      return { status: "report_not_ready" };
    }
    if (reportRun.status === "delivered") {
      return { status: "already_delivered" };
    }

    const { data: existingDelivery, error: existingError } = await supabase
      .from("report_deliveries")
      .select("id, status, attempt_count, last_attempt_at")
      .eq("report_run_id", reportRun.id)
      .eq("channel", "email")
      .eq("destination", destination)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `report_deliveries lookup failed: ${existingError.message}`,
      );
    }
    if (existingDelivery?.status === "delivered") {
      return { status: "already_delivered" };
    }
    if (
      existingDelivery &&
      existingDelivery.attempt_count >= MAX_DELIVERY_ATTEMPTS
    ) {
      return { status: "max_attempts_reached" };
    }
    if (existingDelivery?.last_attempt_at) {
      const elapsedMs = nowInstant.getTime() -
        new Date(existingDelivery.last_attempt_at).getTime();
      if (elapsedMs < MIN_RETRY_INTERVAL_MS) {
        return { status: "retry_backoff" };
      }
    }

    let deliveryId: string;
    if (!existingDelivery) {
      const { data: inserted, error: insertError } = await supabase
        .from("report_deliveries")
        .insert({
          report_run_id: reportRun.id,
          user_id: candidate.user_id,
          channel: "email",
          destination,
          status: "delivering",
          attempt_count: 1,
          last_attempt_at: nowInstant.toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (insertError) {
        // Lost a race to a concurrent tick/worker - not an error.
        if (insertError.code === "23505") {
          return { status: "already_delivered" };
        }
        throw new Error(
          `report_deliveries insert failed: ${insertError.message}`,
        );
      }
      deliveryId = inserted!.id;
    } else {
      deliveryId = existingDelivery.id;
      const { error: updateError } = await supabase
        .from("report_deliveries")
        .update({
          status: "delivering",
          attempt_count: existingDelivery.attempt_count + 1,
          last_attempt_at: nowInstant.toISOString(),
        })
        .eq("id", deliveryId);
      if (updateError) {
        throw new Error(
          `report_deliveries update (claim) failed: ${updateError.message}`,
        );
      }
    }

    const payload = reportRun.report_payload as ReportPayload;

    const emailResult = await sendDailyReportEmail({
      to: destination,
      dateLabel: formatDateKeyLabel(payload.dateKey),
      reportUrl: `${siteUrl()}/reports/${reportRun.id}`,
      closingBalanceRwf: payload.financialSnapshot.closingBalanceRwf,
      moneyReceivedRwf: payload.financialSnapshot.moneyReceivedRwf,
      moneySpentRwf: payload.financialSnapshot.moneySpentRwf,
      feesRwf: payload.financialSnapshot.feesRwf,
      netMovementRwf: payload.financialSnapshot.netMovementRwf,
      budgetSummaryLines: buildBudgetSummaryLines(payload.budget),
      watchOutLines: buildWatchOutLines(payload),
    });

    if (emailResult.ok) {
      await supabase
        .from("report_deliveries")
        .update({
          status: "delivered",
          delivered_at: nowInstant.toISOString(),
          provider_message_id: emailResult.providerMessageId,
        })
        .eq("id", deliveryId);
      await supabase.from("report_runs").update({ status: "delivered" }).eq(
        "id",
        reportRun.id,
      );
      return { status: "delivered" };
    }

    await supabase
      .from("report_deliveries")
      .update({ status: "failed", error_code: emailResult.errorCode })
      .eq("id", deliveryId);
    // Never overwrite an already-delivered report_runs row (defensive -
    // should be unreachable given the early return above, but a report
    // must never be reported as failed once truly delivered).
    await supabase
      .from("report_runs")
      .update({ status: "delivery_failed", error_code: emailResult.errorCode })
      .eq("id", reportRun.id)
      .neq("status", "delivered");

    return { status: "delivery_failed", errorCode: emailResult.errorCode };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type DeliveryTickSummary = {
  candidatesEvaluated: number;
  delivered: number;
  skipped: number;
  errors: { candidateId: string; message: string }[];
  /** true when this tick did nothing because REPORT_EMAIL_DELIVERY_ENABLED=false (operational kill switch). */
  disabled?: true;
};

const EMPTY_DELIVERY_SUMMARY: DeliveryTickSummary = {
  candidatesEvaluated: 0,
  delivered: 0,
  skipped: 0,
  errors: [],
};

/**
 * The delivery tick's entry point - what the (future, not-yet-scheduled)
 * pg_cron-invoked route calls.
 *
 * Guarded by REPORT_EMAIL_DELIVERY_ENABLED, an operational kill switch
 * (master prompt's own rollback strategy: "disable delivery flag without
 * deleting reports" - default enabled, set to the literal string "false"
 * to pause email delivery independently of generation). Reports keep
 * generating and remain fully viewable in-app either way; only the email
 * send itself is paused.
 */
export async function runDailyReportDeliveryTick(
  nowInstant: Date = new Date(),
): Promise<DeliveryTickSummary> {
  if (process.env.REPORT_EMAIL_DELIVERY_ENABLED === "false") {
    return { ...EMPTY_DELIVERY_SUMMARY, disabled: true };
  }

  const supabase = supabaseServer();
  const candidates = await getEmailDeliveryCandidates(supabase);
  const due = candidates.filter((c) => isDeliveryDue(c, nowInstant));

  const summary: DeliveryTickSummary = {
    candidatesEvaluated: due.length,
    delivered: 0,
    skipped: 0,
    errors: [],
  };

  for (const candidate of due) {
    const outcome = await deliverReportForCandidate(
      supabase,
      candidate,
      nowInstant,
    );
    if (outcome.status === "delivered") summary.delivered += 1;
    else if (outcome.status === "error") {
      summary.errors.push({
        candidateId: candidate.id,
        message: outcome.message,
      });
    } else {
      summary.skipped += 1;
    }
  }

  return summary;
}
