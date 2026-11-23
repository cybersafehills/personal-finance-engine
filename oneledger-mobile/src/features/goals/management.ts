import { createClient } from "@supabase/supabase-js";

import { supabase } from "@/api/supabase";
import { selectedWorkspaceId } from "@/features/spaces/selected-space";
import { config } from "@/lib/config";
import type { Currency, GoalType } from "./types";

export type GoalScope = { userId: string; workspaceId: string };
export type NewGoal = {
  id: string;
  name: string;
  description: string | null;
  type: GoalType;
  currency: Currency;
  targetMinor: bigint;
  targetDate: string | null;
};
type Outcome = "saved" | "denied" | "unconfirmed";

export async function canManageGoals(workspaceId: string): Promise<boolean> {
  const response = await supabase?.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "goal.manage",
  });
  return response?.data === true && !response.error;
}

async function scopedClient({ userId, workspaceId }: GoalScope) {
  if (!supabase || selectedWorkspaceId() !== workspaceId) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.id !== userId || selectedWorkspaceId() !== workspaceId) return null;
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

export async function createManagedGoal(scope: GoalScope, draft: NewGoal): Promise<Outcome> {
  try {
    const client = await scopedClient(scope);
    if (!client) return "denied";

    const { data, error } = await client.from("financial_goals").insert({
      id: draft.id,
      workspace_id: scope.workspaceId,
      created_by: scope.userId,
      name: draft.name,
      description: draft.description,
      goal_type: draft.type,
      currency: draft.currency,
      target_amount_minor: draft.targetMinor.toString(),
      target_date: draft.targetDate,
    }).select("id").single();
    if (data?.id === draft.id && !error) return "saved";

    // The draft keeps its UUID and payload after a lost response. A duplicate
    // never changes an existing goal and only confirms our own earlier insert.
    if (error?.code === "23505") {
      const existing = await client.from("financial_goals").select("id")
        .eq("workspace_id", scope.workspaceId).eq("id", draft.id)
        .eq("created_by", scope.userId).maybeSingle();
      if (existing.data?.id === draft.id) return "saved";
    }
    return error?.code === "42501" ? "denied" : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}

export async function archiveManagedGoal(scope: GoalScope, goalId: string): Promise<Outcome> {
  try {
    const client = await scopedClient(scope);
    if (!client) return "denied";
    const { data, error } = await client.from("financial_goals")
      .update({ status: "archived", completed_at: null })
      .eq("workspace_id", scope.workspaceId).eq("id", goalId)
      .select("id").maybeSingle();
    if (data?.id === goalId && !error) return "saved";
    return !error || error.code === "42501" ? "denied" : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}

export async function removeGoalContribution(scope: GoalScope, goalId: string, entryId: string): Promise<Outcome> {
  try {
    const client = await scopedClient(scope);
    if (!client) return "denied";
    const { data, error } = await client.from("goal_contributions").delete()
      .eq("workspace_id", scope.workspaceId).eq("goal_id", goalId).eq("id", entryId)
      .select("id").maybeSingle();
    if (data?.id === entryId && !error) return "saved";
    return error?.code === "42501" ? "denied" : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}
