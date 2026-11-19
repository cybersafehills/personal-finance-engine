import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { CURRENCY_SCALE } from "../../../../shared/financial";
import { supabase } from "@/api/supabase";
import { selectedWorkspaceId } from "@/features/spaces/selected-space";
import { config } from "@/lib/config";
import { deviceStore } from "@/lib/device-store";
import type { Currency } from "./types";

export function contributionMinor(input: string, currency: Currency): bigint | null {
  const parts = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
  const scale = CURRENCY_SCALE[currency];
  if (!parts || (parts[2]?.length ?? 0) > scale || parts[1].length > 16) return null;
  const amount = BigInt(parts[1] + (parts[2] ?? "").padEnd(scale, "0"));
  return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? amount : null;
}

export type ContributionRequest = {
  id: string;
  userId: string;
  workspaceId: string;
  goalId: string;
  currency: Currency;
  amount: bigint;
  date: string;
};

type ContributionScope = Pick<ContributionRequest, "userId" | "workspaceId" | "goalId">;

function pendingKey(scope: ContributionScope) {
  return `oneledger.goal-pending.${scope.userId}.${scope.workspaceId}.${scope.goalId}`;
}

export async function restorePendingContribution(scope: ContributionScope, currency: Currency): Promise<ContributionRequest | null> {
  if (Platform.OS === "web") return null;
  const raw = await deviceStore.get(pendingKey(scope));
  if (!raw) return null;
  const draft = JSON.parse(raw) as { id?: string; currency?: string; date?: string; amount?: string };
  if (!draft.id || draft.currency !== currency || !draft.date || !draft.amount || !/^\d+$/.test(draft.amount)) {
    throw new Error("Pending contribution could not be read");
  }
  return { ...scope, id: draft.id, currency, date: draft.date, amount: BigInt(draft.amount) };
}

export async function storePendingContribution(draft: ContributionRequest): Promise<void> {
  if (Platform.OS === "web") throw new Error("Secure storage unavailable");
  const { id, currency, date, amount } = draft;
  await deviceStore.set(pendingKey(draft), JSON.stringify({ id, currency, date, amount: amount.toString() }));
}

export async function clearPendingContribution(scope: ContributionScope): Promise<void> {
  await deviceStore.remove(pendingKey(scope));
}

type SaveResult = "saved" | "retry" | "denied";

export async function saveGoalContribution(draft: ContributionRequest): Promise<SaveResult> {
  if (!supabase) return "denied";
  try {
    if (selectedWorkspaceId() !== draft.workspaceId) return "denied";
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.id !== draft.userId || selectedWorkspaceId() !== draft.workspaceId) return "denied";

    const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    });
    const { data, error } = await client.rpc("record_goal_contribution", {
      p_operation_id: draft.id,
      p_workspace_id: draft.workspaceId,
      p_goal_id: draft.goalId,
      p_currency: draft.currency,
      p_amount_minor: draft.amount.toString(),
      p_contribution_date: draft.date,
    });

    if (!error && (data === "recorded" || data === "replayed")) return "saved";
    if (error?.code && ["22023", "42501", "P0002"].includes(error.code)) return "denied";
    return "retry";
  } catch {
    return "retry";
  }
}

type ContributionRow = {
  id: string;
  amount_minor: number | string;
  contribution_date: string;
  source: "manual" | "transaction_link";
  created_by: string | null;
};

export async function loadGoalContributions(workspaceId: string, goalId: string) {
  if (!supabase || selectedWorkspaceId() !== workspaceId) throw new Error("Goal history unavailable");
  const { data, error } = await supabase
    .from("goal_contributions")
    .select("id,amount_minor,contribution_date,source,created_by")
    .eq("workspace_id", workspaceId)
    .eq("goal_id", goalId)
    .order("contribution_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as ContributionRow[];
}
