import { Platform } from "react-native";

import { completePages, CURRENCY_SCALE, isCurrency, type Currency } from "../../../../web/shared/financial";
import { deviceStore } from "@/lib/device-store";
import { allocationPercentages, type AllocationFields, type Percentages } from "./allocation-editor";
import { budgetSession, type BudgetScope } from "./budget-session";

export const FREQUENCIES = {
  monthly: "Monthly",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  annual: "Annual",
} as const;
type Frequency = keyof typeof FREQUENCIES;

export type BudgetInput = {
  name: string;
  currency: Currency;
  start: string;
  end: string;
  income: string;
  frequency: Frequency;
  allocation: AllocationFields;
};

type Draft = Omit<BudgetInput, "income" | "allocation"> & { incomeMinor: string; percentages: Percentages };
export type PendingDraft = Draft & { id: string };
export type DraftRow = { id: string; name: string; currency: string; period_start: string; period_end: string };

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseBudgetInput(input: BudgetInput): { draft: Draft } | { error: string } {
  const name = input.name.trim();
  if (!name || name.length > 80) return { error: "Give your budget a name of up to 80 characters." };
  if (!isDate(input.start) || !isDate(input.end) || input.end <= input.start) {
    return { error: "Enter valid dates in YYYY-MM-DD format, with the end date after the start date." };
  }
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(input.income.trim());
  const scale = CURRENCY_SCALE[input.currency];
  const fraction = match?.[2] ?? "";
  if (!match || fraction.length > scale) return { error: `Enter income in ${input.currency} using the correct decimal places.` };
  const income = BigInt(match[1] + fraction.padEnd(scale, "0"));
  const annualMultiplier = { monthly: 12n, weekly: 52n, biweekly: 26n, semimonthly: 24n, annual: 1n }[input.frequency];
  if (income * annualMultiplier > BigInt(Number.MAX_SAFE_INTEGER)) return { error: "That income is too large to use in a budget." };
  const percentages = allocationPercentages(input.allocation);
  if (!percentages) return { error: "Enter four percentages that add up to exactly 100%." };
  return { draft: { name, currency: input.currency, start: input.start, end: input.end,
    frequency: input.frequency, incomeMinor: String(income), percentages } };
}

function pendingKey(scope: BudgetScope) {
  return `oneledger.budget-pending.${scope.userId}.${scope.workspaceId}`;
}

export async function readPendingBudget(scope: BudgetScope): Promise<PendingDraft | null> {
  if (Platform.OS === "web") return null;
  const value = await deviceStore.get(pendingKey(scope));
  if (!value) return null;
  const draft = JSON.parse(value) as PendingDraft;
  if (!draft.id || !isCurrency(draft.currency) || typeof draft.incomeMinor !== "string" || !draft.percentages) {
    throw new Error("Invalid pending budget");
  }
  return draft;
}

export async function storePendingBudget(scope: BudgetScope, draft: PendingDraft) {
  if (Platform.OS === "web") throw new Error("Secure storage unavailable");
  await deviceStore.set(pendingKey(scope), JSON.stringify(draft));
}

export async function clearPendingBudget(scope: BudgetScope) {
  await deviceStore.remove(pendingKey(scope));
}

export async function loadDraftBudgets(scope: BudgetScope): Promise<DraftRow[]> {
  const client = await budgetSession(scope);
  if (!client) throw new Error("Budget session unavailable");
  return completePages<DraftRow>(async (offset, size) => {
    const { data, error } = await client.from("budgets").select("id,name,currency,period_start,period_end")
      .eq("workspace_id", scope.workspaceId).eq("status", "draft")
      .order("created_at", { ascending: false }).order("id").range(offset, offset + size - 1);
    if (error) throw error;
    return data ?? [];
  });
}

export async function createDraftBudget(scope: BudgetScope, draft: PendingDraft) {
  try {
    const client = await budgetSession(scope);
    if (!client) return "denied";
    const { data, error } = await client.rpc("create_budget_draft", {
      p_operation_id: draft.id, p_workspace_id: scope.workspaceId, p_name: draft.name,
      p_currency: draft.currency, p_period_start: draft.start, p_period_end: draft.end,
      p_income_minor: draft.incomeMinor, p_income_frequency: draft.frequency, p_percentages: draft.percentages,
    });
    if (!error && data === draft.id) return "saved";
    if (error?.code === "22023" || error?.code === "42501") return "denied";
  } catch {
    // The same persisted request can be retried if no response arrives.
  }
  return "unconfirmed";
}

export async function activateDraftBudget(scope: BudgetScope, budgetId: string, revision: string) {
  try {
    const client = await budgetSession(scope);
    if (!client) return "denied";
    const { data, error } = await client.rpc("activate_budget_draft", {
      p_workspace_id: scope.workspaceId, p_budget_id: budgetId, p_expected_revision: revision,
    });
    if (!error && data === "active") return "saved";
    if (error?.code === "23505") return "conflict";
    if (error?.code === "40001") return "stale";
    if (error?.code === "42501" || error?.code === "P0002" || error?.code === "22023") return "denied";
  } catch {
    // Reload to show the authoritative state if acknowledgement was lost.
  }
  return "unconfirmed";
}
