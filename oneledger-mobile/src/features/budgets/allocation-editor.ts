import { isCurrency } from "../../../../web/shared/financial";
import { supabase } from "@/api/supabase";
import { budgetSession, type BudgetScope } from "./budget-session";

export const ALLOCATION_TYPES = ["ESSENTIALS", "INVESTING", "EMERGENCY", "WANTS"] as const;
export type AllocationType = typeof ALLOCATION_TYPES[number];
export type AllocationFields = Record<AllocationType, string>;
export type Percentages = Record<AllocationType, number>;

export function allocationPercentages(fields: AllocationFields): Percentages | null {
  const percentages = {} as Percentages;
  let total = 0;
  for (const type of ALLOCATION_TYPES) {
    const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(fields[type].trim());
    if (!match) return null;
    const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    if (basisPoints > 10000) return null;
    percentages[type] = basisPoints / 100;
    total += basisPoints;
  }
  return total === 10000 ? percentages : null;
}

export type AllocationSnapshot = {
  revision: string;
  currency: string;
  allocations: { type: AllocationType; percentage: number; target_minor: string }[];
};

type Scope = BudgetScope & { budgetId: string };
type Edit = { revision: string; percentages: Percentages; save: boolean };
type Result =
  | { kind: "snapshot"; value: AllocationSnapshot }
  | { kind: "saved" | "stale" | "denied" | "invalid" | "unavailable" };

export async function canEditAllocations(workspaceId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "budget.manage",
  });
  return !error && data === true;
}

function isSnapshot(data: unknown): data is AllocationSnapshot {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Partial<AllocationSnapshot>;
  return typeof candidate.revision === "string" && typeof candidate.currency === "string" && isCurrency(candidate.currency)
    && Array.isArray(candidate.allocations) && candidate.allocations.length === ALLOCATION_TYPES.length
    && ALLOCATION_TYPES.every((type) => candidate.allocations?.some((a) =>
      a?.type === type && Number.isFinite(a.percentage) && typeof a.target_minor === "string" && /^\d+$/.test(a.target_minor)));
}

export async function editAllocationPlan(scope: Scope, edit?: Edit): Promise<Result> {
  if (!supabase) return { kind: "unavailable" };
  try {
    const client = await budgetSession(scope);
    if (!client) return { kind: "denied" };
    const { data, error } = await client.rpc("edit_budget_allocations", {
      p_workspace_id: scope.workspaceId,
      p_budget_id: scope.budgetId,
      ...(edit && { p_expected_revision: edit.revision, p_percentages: edit.percentages, p_save: edit.save }),
    });
    if (error?.code === "40001") return { kind: "stale" };
    if (error?.code === "42501" || error?.code === "P0002") return { kind: "denied" };
    if (error?.code === "22023") return { kind: "invalid" };
    if (error) return { kind: "unavailable" };
    if (edit?.save && data?.saved === true) return { kind: "saved" };
    if (isSnapshot(data)) return { kind: "snapshot", value: data };
  } catch {
    // A failed connection is distinct from a confirmed database rejection.
  }
  return { kind: "unavailable" };
}
