import { supabase } from "@/api/supabase";
import { QueryError } from "@/features/transactions/queries";

import type { Currency, Goal, GoalProgress, GoalStatus, GoalType } from "./types";

// Reads under the signed-in user's RLS, like the web's getGoals / getGoalProgress
// (web/lib/queries.ts). Progress, the required monthly saving and the projection
// come from the database's own goal_progress() (a SECURITY DEFINER function that
// checks Space membership itself), never from client maths. Contributing to a
// goal stays on the web.

const COLUMNS =
  "id, goal_type, name, description, currency, target_amount_minor, current_amount_minor, target_date, status";
const CURRENCIES: readonly string[] = ["RWF", "EUR", "USD"];
const MAX_GOALS = 50;

type Row = {
  id: string;
  goal_type: GoalType;
  name: string;
  description: string | null;
  currency: string;
  target_amount_minor: number;
  current_amount_minor: number;
  target_date: string | null;
  status: GoalStatus;
};

type ProgressRow = {
  pct_complete: number | string;
  months_to_target: number | string | null;
  required_monthly_minor: number;
  recent_monthly_rate_minor: number;
  projected_completion_date: string | null;
};

async function progressFor(goalId: string): Promise<GoalProgress | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("goal_progress", { p_goal_id: goalId });
  if (error) return null; // the goal still shows, just without a pace line
  const row = ((data ?? []) as unknown as ProgressRow[])[0];
  if (!row) return null;
  return {
    pctComplete: Number(row.pct_complete),
    monthsToTarget: row.months_to_target === null ? null : Number(row.months_to_target),
    requiredMonthlyMinor: Number(row.required_monthly_minor),
    recentMonthlyRateMinor: Number(row.recent_monthly_rate_minor),
    projectedCompletionDate: row.projected_completion_date,
  };
}

export async function getGoals(): Promise<Goal[]> {
  if (!supabase) throw new QueryError("This build isn't connected to OneLedger yet.");
  const { data, error } = await supabase
    .from("financial_goals")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MAX_GOALS);
  if (error) throw new QueryError(error.message);

  // A goal in a currency the app cannot format is left out, as on the web.
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => CURRENCIES.includes(r.currency));
  return Promise.all(
    rows.map(async (r): Promise<Goal> => ({
      id: r.id,
      type: r.goal_type,
      name: r.name,
      description: r.description,
      currency: r.currency as Currency,
      targetMinor: Number(r.target_amount_minor),
      currentMinor: Number(r.current_amount_minor),
      targetDate: r.target_date,
      status: r.status,
      progress: r.status === "active" ? await progressFor(r.id) : null,
    })),
  );
}
