"use server";

import { revalidatePath } from "next/cache";
import { trackSpacesEvent } from "../../../lib/spaces/analytics";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";

export type PolicyActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

const MATCH_TYPES = ["exact", "contains", "starts_with", "regex"] as const;
type MatchType = (typeof MATCH_TYPES)[number];

const DIRECTIONS = ["in", "out", "neutral"] as const;
type Direction = (typeof DIRECTIONS)[number];

function isMatchType(value: string): value is MatchType {
  return (MATCH_TYPES as readonly string[]).includes(value);
}

function isDirection(value: string): value is Direction {
  return (DIRECTIONS as readonly string[]).includes(value);
}

/** Parses a form-supplied string into a non-negative integer, or null for blank. Returns undefined on an invalid value. */
function parseOptionalAmount(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * Parses a comma/space separated list of integers into a sorted,
 * de-duplicated array within [min, max]. "" -> null (unconstrained);
 * undefined signals an invalid entry so the caller can report it.
 */
function parseIntList(
  value: string,
  min: number,
  max: number,
): number[] | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  const out = new Set<number>();
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < min || n > max) return undefined;
    out.add(n);
  }
  return out.size > 0 ? Array.from(out).sort((a, b) => a - b) : null;
}

const KNOWN_TRANSACTION_TYPES = new Set([
  "send_money", "merchant_payment", "money_received", "airtime",
  "cash_withdrawal", "cash_deposit", "bill_payment", "bank_transfer",
  "refund", "reversal", "other",
]);

export type PolicyFormInput = {
  name: string;
  description: string;
  category: string;
  subcategory: string;
  matchType: string;
  merchantPattern: string;
  direction: string; // "" = any
  amountMin: string;
  amountMax: string;
  timeStart: string; // "" or "HH:MM"
  timeEnd: string;
  /** Comma list of ISO weekdays 1-7 (Mon-Sun). "" = any day. */
  daysOfWeek: string;
  /** Comma list of month days 1-31. "" = any. */
  daysOfMonth: string;
  transactionTypes: string[]; // [] = any
  feeMin: string;
  feeMax: string;
  amountRoundMultiple: string; // "" | "100" | "1000"
  priority: string;
  scopeType: string; // "space" | "source"
  scopeSourceId: string; // "" unless scopeType === "source"
};

/**
 * Creates or updates a categorization policy (policyId present = update).
 * Every check here mirrors a real database constraint from
 * 20260829000000_phase_f_categorization_policies.sql (amount range,
 * time-window both-or-neither, at-least-one-condition) so the user sees a
 * friendly message instead of a raw Postgres error - the database
 * constraints remain the actual source of truth and are re-checked there
 * regardless of what this function validates.
 */
export async function upsertPolicy(
  input: PolicyFormInput,
  policyId?: string,
): Promise<PolicyActionResult> {
  const trimmedCategory = input.category.trim();
  if (!trimmedCategory) {
    return { ok: false, error: "Category cannot be empty." };
  }

  const trimmedPattern = input.merchantPattern.trim() || null;
  if (trimmedPattern && !isMatchType(input.matchType)) {
    return { ok: false, error: "Unrecognized match type." };
  }

  const direction = input.direction.trim();
  if (direction && !isDirection(direction)) {
    return { ok: false, error: "Unrecognized direction." };
  }

  const amountMin = parseOptionalAmount(input.amountMin);
  const amountMax = parseOptionalAmount(input.amountMax);
  if (amountMin === undefined || amountMax === undefined) {
    return { ok: false, error: "Amounts must be whole numbers of RWF, 0 or greater." };
  }
  if (amountMin !== null && amountMax !== null && amountMax < amountMin) {
    return { ok: false, error: "Maximum amount cannot be less than the minimum." };
  }

  const timeStart = input.timeStart.trim() || null;
  const timeEnd = input.timeEnd.trim() || null;
  if ((timeStart === null) !== (timeEnd === null)) {
    return { ok: false, error: "Set both a start and an end time, or leave both blank." };
  }

  const daysOfWeek = parseIntList(input.daysOfWeek, 1, 7);
  if (daysOfWeek === undefined) {
    return { ok: false, error: "Days of the week must be numbers 1 (Mon) to 7 (Sun)." };
  }
  const daysOfMonth = parseIntList(input.daysOfMonth, 1, 31);
  if (daysOfMonth === undefined) {
    return { ok: false, error: "Days of the month must be numbers 1 to 31." };
  }

  const transactionTypes = (input.transactionTypes ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
  if (transactionTypes.some((t) => !KNOWN_TRANSACTION_TYPES.has(t))) {
    return { ok: false, error: "Unrecognized transaction type." };
  }
  const transactionTypesValue = transactionTypes.length > 0 ? transactionTypes : null;

  const feeMin = parseOptionalAmount(input.feeMin);
  const feeMax = parseOptionalAmount(input.feeMax);
  if (feeMin === undefined || feeMax === undefined) {
    return { ok: false, error: "Fees must be whole numbers of RWF, 0 or greater." };
  }
  if (feeMin !== null && feeMax !== null && feeMax < feeMin) {
    return { ok: false, error: "Maximum fee cannot be less than the minimum." };
  }

  const roundRaw = input.amountRoundMultiple.trim();
  const amountRoundMultiple = roundRaw === "" ? null : Number(roundRaw);
  if (amountRoundMultiple !== null && amountRoundMultiple !== 100 && amountRoundMultiple !== 1000) {
    return { ok: false, error: "Round-number match must be 100 or 1000." };
  }

  const hasCondition = trimmedPattern !== null || direction !== "" ||
    amountMin !== null || amountMax !== null || timeStart !== null ||
    daysOfWeek !== null || daysOfMonth !== null || transactionTypesValue !== null ||
    feeMin !== null || feeMax !== null || amountRoundMultiple !== null;
  if (!hasCondition) {
    return {
      ok: false,
      error: "Add at least one condition (counterparty, direction, amount, time, day, type, fee, or round-number).",
    };
  }

  const priorityParsed = input.priority.trim()
    ? Number(input.priority.trim())
    : 100;
  if (!Number.isInteger(priorityParsed)) {
    return { ok: false, error: "Priority must be a whole number." };
  }

  const scopeType = input.scopeType === "source" ? "source" : "space";
  const scopeSourceId = scopeType === "source"
    ? input.scopeSourceId.trim()
    : "";
  if (scopeType === "source" && !scopeSourceId) {
    return { ok: false, error: "Choose which account this rule applies to." };
  }

  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();

  const record = {
    name: input.name.trim() || null,
    description: input.description.trim() || null,
    category: trimmedCategory,
    subcategory: input.subcategory.trim() || null,
    match_type: trimmedPattern ? input.matchType : "contains",
    merchant_pattern: trimmedPattern,
    normalized_merchant_name: trimmedPattern,
    direction: direction || null,
    amount_min_rwf: amountMin,
    amount_max_rwf: amountMax,
    time_start: timeStart,
    time_end: timeEnd,
    days_of_week: daysOfWeek,
    days_of_month: daysOfMonth,
    transaction_types: transactionTypesValue,
    fee_min_rwf: feeMin,
    fee_max_rwf: feeMax,
    amount_round_multiple: amountRoundMultiple,
    priority: priorityParsed,
    scope_type: scopeType,
    scope_source_id: scopeType === "source" ? scopeSourceId : null,
  };

  if (policyId) {
    const { error } = await supabase
      .from("categorization_policies")
      .update(record)
      .eq("id", policyId)
      .eq("workspace_id", workspaceId);

    if (error) {
      return { ok: false, error: "Could not save the rule." };
    }

    revalidatePath("/categories/rules");
    revalidatePath("/categories");
    if (scopeType === "source") trackSpacesEvent("rule_scope_set", { scope: "source" });
    return { ok: true, id: policyId };
  }

  const { data, error } = await supabase
    .from("categorization_policies")
    .insert({
      ...record,
      workspace_id: workspaceId,
      rule_source: "manual",
      confidence: 1,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "Could not save the rule." };
  }

  revalidatePath("/categories/rules");
  revalidatePath("/categories");
  if (scopeType === "source") trackSpacesEvent("rule_scope_set", { scope: "source" });
  return { ok: true, id: data.id };
}

/**
 * Pauses or reactivates a policy. There is no delete: categorization_policies
 * has no delete grant for authenticated (same append/soft-lifecycle
 * convention as accounts) - pausing is the only retirement path.
 */
export async function setPolicyActive(
  policyId: string,
  isActive: boolean,
): Promise<PolicyActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("categorization_policies")
    .update({ is_active: isActive })
    .eq("id", policyId)
    .eq("workspace_id", workspaceId);

  if (error) {
    return { ok: false, error: "Could not update the rule." };
  }

  revalidatePath("/categories/rules");
  revalidatePath("/categories");
  return { ok: true };
}

/**
 * Moves a policy one place up/down in evaluation order. Renumbers every
 * policy in the workspace to sequential multiples of 10 in the new order
 * rather than just swapping two raw priority values - most policies
 * default to priority 100, so a plain swap would frequently be a no-op
 * against a tied neighbor. A handful of .update() calls, not a single
 * transaction, but each is workspace-scoped like every other write here
 * and the worst case of a partial failure is a harmless temporary
 * reordering, not data loss.
 */
export async function movePolicyPriority(
  policyId: string,
  direction: "up" | "down",
): Promise<PolicyActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { data: policies, error: fetchError } = await supabase
    .from("categorization_policies")
    .select("id, priority, created_at")
    .eq("workspace_id", workspaceId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (fetchError || !policies) {
    return { ok: false, error: "Could not load rules to reorder." };
  }

  const index = policies.findIndex((p) => p.id === policyId);
  if (index === -1) {
    return { ok: false, error: "Rule not found." };
  }

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= policies.length) {
    return { ok: true };
  }

  const reordered = [...policies];
  [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

  for (let i = 0; i < reordered.length; i++) {
    const newPriority = (i + 1) * 10;
    if (reordered[i].priority !== newPriority) {
      const { error } = await supabase
        .from("categorization_policies")
        .update({ priority: newPriority })
        .eq("id", reordered[i].id)
        .eq("workspace_id", workspaceId);
      if (error) {
        return { ok: false, error: "Could not save the new order." };
      }
    }
  }

  revalidatePath("/categories/rules");
  return { ok: true };
}
