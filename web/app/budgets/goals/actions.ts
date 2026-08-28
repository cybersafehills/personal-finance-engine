"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isSupportedCurrency, toMinorUnits } from "../../../lib/money";

export type GoalActionResult =
  | { ok: true; goalId: string }
  | { ok: false; error: string };
export type SimpleActionResult = { ok: true } | { ok: false; error: string };

const GOAL_TYPES = [
  "emergency_fund",
  "investing",
  "planned_purchase",
  "debt",
  "general_savings",
] as const;

function isGoalType(value: string): value is (typeof GOAL_TYPES)[number] {
  return (GOAL_TYPES as readonly string[]).includes(value);
}

export async function createGoal(input: {
  goalType: string;
  name: string;
  description: string;
  currency: string;
  targetAmountText: string;
  targetDate: string | null;
}): Promise<GoalActionResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Give this goal a name." };
  }
  if (!isGoalType(input.goalType)) {
    return { ok: false, error: "Unrecognized goal type." };
  }
  if (!isSupportedCurrency(input.currency)) {
    return { ok: false, error: "Unsupported currency." };
  }

  let targetAmountMinor: bigint;
  try {
    targetAmountMinor = toMinorUnits(input.targetAmountText, input.currency);
  } catch {
    return { ok: false, error: "Enter a valid target amount." };
  }
  if (targetAmountMinor <= 0n) {
    return { ok: false, error: "Target amount must be greater than zero." };
  }

  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("financial_goals")
    .insert({
      workspace_id: workspaceId,
      goal_type: input.goalType,
      name: trimmedName,
      description: input.description.trim() || null,
      currency: input.currency,
      target_amount_minor: targetAmountMinor,
      target_date: input.targetDate || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "Could not create the goal." };
  }

  revalidatePath("/budgets/goals");
  return { ok: true, goalId: data.id };
}

/** Adds a manual contribution (no linked transaction). financial_goals.current_amount_minor is kept in sync by the refresh_goal_current_amount trigger - never updated here directly. */
export async function addManualContribution(
  goalId: string,
  amountText: string,
  contributionDate: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { data: goal, error: goalError } = await supabase
    .from("financial_goals")
    .select("currency, workspace_id")
    .eq("id", goalId)
    .maybeSingle();

  if (goalError || !goal || !isSupportedCurrency(goal.currency)) {
    return { ok: false, error: "Goal not found." };
  }

  let amountMinor: bigint;
  try {
    amountMinor = toMinorUnits(amountText, goal.currency);
  } catch {
    return { ok: false, error: "Enter a valid contribution amount." };
  }
  if (amountMinor <= 0n) {
    return { ok: false, error: "Contribution amount must be greater than zero." };
  }
  if (!contributionDate) {
    return { ok: false, error: "Choose a contribution date." };
  }

  const { error } = await supabase.from("goal_contributions").insert({
    goal_id: goalId,
    workspace_id: goal.workspace_id,
    amount_minor: amountMinor,
    contribution_date: contributionDate,
    source: "manual",
  });

  if (error) {
    return { ok: false, error: "Could not record the contribution." };
  }

  revalidatePath(`/budgets/goals/${goalId}`);
  revalidatePath("/budgets/goals");
  return { ok: true };
}

/** Removes a mis-entered contribution. Contributions are otherwise append-only (never edited in place) - see the Phase D migration's own comment on goal_contributions. */
export async function removeContribution(
  contributionId: string,
  goalId: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("goal_contributions")
    .delete()
    .eq("id", contributionId);

  if (error) {
    return { ok: false, error: "Could not remove the contribution." };
  }

  revalidatePath(`/budgets/goals/${goalId}`);
  revalidatePath("/budgets/goals");
  return { ok: true };
}

export async function completeGoal(goalId: string): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("financial_goals")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", goalId);

  if (error) {
    return { ok: false, error: "Could not mark the goal complete." };
  }

  revalidatePath(`/budgets/goals/${goalId}`);
  revalidatePath("/budgets/goals");
  return { ok: true };
}

/**
 * Replaces the participant set for a shared goal. set_goal_participants
 * (supabase/migrations/20260919000000_phase_t_shared_goals.sql) enforces
 * goal.manage and that every id is an active member of the Space - this
 * only passes the ids through.
 */
export async function setGoalParticipants(
  goalId: string,
  userIds: string[],
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("set_goal_participants", {
    p_goal_id: goalId,
    p_user_ids: userIds,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.message.length > 0 && error.message.length < 200
          ? error.message
          : "Could not update the participants.",
    };
  }

  revalidatePath(`/budgets/goals/${goalId}`);
  return { ok: true };
}

export async function archiveGoal(goalId: string): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("financial_goals")
    .update({ status: "archived" })
    .eq("id", goalId);

  if (error) {
    return { ok: false, error: "Could not archive the goal." };
  }

  revalidatePath(`/budgets/goals/${goalId}`);
  revalidatePath("/budgets/goals");
  return { ok: true };
}
