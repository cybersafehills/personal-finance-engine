"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getOwnedWorkspaceId, getVariableIncomeMonths, VariableIncomeMonth } from "../../lib/queries";
import {
  allocateAmounts,
  AllocationPercentages,
  ALLOCATION_TYPES,
  AllocationType,
  IncomeFrequency,
  INCOME_FREQUENCIES,
  isExactly100Percent,
  normalizeIncome,
  validatePercentages,
} from "../../lib/budget-math";
import { isSupportedCurrency, SupportedCurrency, toMinorUnits } from "../../lib/money";

export type BudgetActionResult =
  | { ok: true; budgetId: string }
  | { ok: false; error: string };

export type SimpleActionResult = { ok: true } | { ok: false; error: string };

export type BudgetDraftInput = {
  name: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  incomeAmountText: string;
  incomeFrequency: string;
  percentages: AllocationPercentages;
  templateId?: string | null;
  /** Informational only - does not change how incomeAmountText is normalized. Records that this figure came from (or was checked against) the 3-month variable-income recommendation, see BudgetCalculator's variable-income mode. */
  incomeMode?: "fixed" | "variable";
};

function isIncomeFrequency(value: string): value is IncomeFrequency {
  return (INCOME_FREQUENCIES as readonly string[]).includes(value);
}

/**
 * Validates and normalizes a raw draft-budget submission into strongly
 * typed, safe-to-persist values. Shared by createBudget and
 * updateBudgetIncome so client-submitted input is never trusted directly
 * by either write path (server-side validation, independent of whatever
 * the calculator UI already checked - see the master prompt's own "do
 * not rely on client-side validation for financial integrity" rule).
 */
function parseDraftInput(input: BudgetDraftInput):
  | {
    ok: true;
    currency: SupportedCurrency;
    incomeAmountMinor: bigint;
    monthlyIncomeMinor: bigint;
    annualIncomeMinor: bigint;
    incomeFrequency: IncomeFrequency;
    targets: Record<AllocationType, bigint>;
  }
  | { ok: false; error: string } {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Budget name cannot be empty." };
  }

  if (!isSupportedCurrency(input.currency)) {
    return { ok: false, error: "Unsupported currency." };
  }

  if (!isIncomeFrequency(input.incomeFrequency)) {
    return { ok: false, error: "Unrecognized income frequency." };
  }

  if (
    !input.periodStart || !input.periodEnd ||
    new Date(input.periodEnd) <= new Date(input.periodStart)
  ) {
    return { ok: false, error: "Period end must be after period start." };
  }

  const percentageValidation = validatePercentages(input.percentages);
  if (!percentageValidation.valid) {
    return { ok: false, error: percentageValidation.error };
  }

  let incomeAmountMinor: bigint;
  try {
    incomeAmountMinor = toMinorUnits(input.incomeAmountText, input.currency);
  } catch {
    return { ok: false, error: "Enter a valid income amount." };
  }
  if (incomeAmountMinor < 0n) {
    return { ok: false, error: "Income cannot be negative." };
  }

  const { monthlyMinor, annualMinor } = normalizeIncome(
    incomeAmountMinor,
    input.incomeFrequency,
  );
  const targets = allocateAmounts(monthlyMinor, input.percentages);

  return {
    ok: true,
    currency: input.currency,
    incomeAmountMinor,
    monthlyIncomeMinor: monthlyMinor,
    annualIncomeMinor: annualMinor,
    incomeFrequency: input.incomeFrequency,
    targets,
  };
}

type InsertBudgetInput = {
  workspaceId: string;
  templateId: string | null;
  name: string;
  currency: SupportedCurrency;
  periodStart: string;
  periodEnd: string;
  incomeAmountMinor: bigint;
  monthlyIncomeMinor: bigint;
  annualIncomeMinor: bigint;
  incomeFrequency: IncomeFrequency;
  incomeMode: "fixed" | "variable";
  percentages: AllocationPercentages;
  sourceBudgetId?: string;
};

/**
 * Shared insert path for a new draft budget + its four allocations, once
 * every value is already a validated bigint/enum - never re-parses a
 * decimal string. createBudget() (public entry point, parses raw text
 * input) and duplicateBudget() (already has exact minor-unit values from
 * the source budget row) both funnel through this, specifically so
 * duplicateBudget never has to round-trip a minor-unit integer back
 * through toMinorUnits()'s major-unit text parser - doing so would
 * misinterpret EUR/USD cent amounts as whole-currency-unit amounts.
 *
 * Not atomic across the two inserts (the Supabase JS client has no
 * multi-statement transaction primitive) - if the allocations insert
 * fails after the budget insert succeeds, the orphaned draft budget row
 * is explicitly deleted as a compensating action rather than left behind
 * half-formed.
 */
async function insertBudgetWithAllocations(
  input: InsertBudgetInput,
): Promise<BudgetActionResult> {
  const targets = allocateAmounts(input.monthlyIncomeMinor, input.percentages);

  const supabase = await supabaseSession();
  const { data: budget, error: budgetError } = await supabase
    .from("budgets")
    .insert({
      workspace_id: input.workspaceId,
      template_id: input.templateId,
      name: input.name,
      currency: input.currency,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      income_amount_minor: input.incomeAmountMinor,
      normalized_monthly_income_minor: input.monthlyIncomeMinor,
      normalized_annual_income_minor: input.annualIncomeMinor,
      income_frequency: input.incomeFrequency,
      income_mode: input.incomeMode,
      source_budget_id: input.sourceBudgetId ?? null,
    })
    .select("id")
    .single();

  if (budgetError || !budget) {
    return { ok: false, error: "Could not create the budget." };
  }

  const { error: allocationsError } = await supabase
    .from("budget_allocations")
    .insert(
      ALLOCATION_TYPES.map((type, index) => ({
        budget_id: budget.id,
        workspace_id: input.workspaceId,
        allocation_type: type,
        percentage: input.percentages[type],
        target_amount_minor: targets[type],
        sort_order: index,
      })),
    );

  if (allocationsError) {
    await supabase.from("budgets").delete().eq("id", budget.id);
    return { ok: false, error: "Could not create the budget's allocations." };
  }

  revalidatePath("/budgets");
  return { ok: true, budgetId: budget.id };
}

/** Creates a new draft budget with its four allocations from raw calculator input. */
export async function createBudget(
  input: BudgetDraftInput,
): Promise<BudgetActionResult> {
  const parsed = parseDraftInput(input);
  if (!parsed.ok) return parsed;

  const workspaceId = await getOwnedWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  return insertBudgetWithAllocations({
    workspaceId,
    templateId: input.templateId ?? null,
    name: input.name.trim(),
    currency: parsed.currency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    incomeAmountMinor: parsed.incomeAmountMinor,
    monthlyIncomeMinor: parsed.monthlyIncomeMinor,
    annualIncomeMinor: parsed.annualIncomeMinor,
    incomeFrequency: parsed.incomeFrequency,
    incomeMode: input.incomeMode ?? "fixed",
    percentages: input.percentages,
  });
}

/**
 * Replaces a draft or active budget's income figures and recomputes every
 * allocation's target_amount_minor from its existing percentage. Percentages
 * themselves are changed via updateBudgetAllocations, not here.
 */
export async function updateBudgetIncome(
  budgetId: string,
  incomeAmountText: string,
  incomeFrequency: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { data: budget, error: budgetLookupError } = await supabase
    .from("budgets")
    .select("id, currency")
    .eq("id", budgetId)
    .maybeSingle();

  if (budgetLookupError || !budget) {
    return { ok: false, error: "Budget not found." };
  }

  const { data: allocationRows, error: allocationLookupError } = await supabase
    .from("budget_allocations")
    .select("allocation_type, percentage")
    .eq("budget_id", budgetId);

  if (allocationLookupError || !allocationRows) {
    return { ok: false, error: "Could not load the budget's allocations." };
  }

  if (!isIncomeFrequency(incomeFrequency)) {
    return { ok: false, error: "Unrecognized income frequency." };
  }
  if (!isSupportedCurrency(budget.currency)) {
    return { ok: false, error: "Unsupported currency." };
  }

  let incomeAmountMinor: bigint;
  try {
    incomeAmountMinor = toMinorUnits(incomeAmountText, budget.currency);
  } catch {
    return { ok: false, error: "Enter a valid income amount." };
  }
  if (incomeAmountMinor < 0n) {
    return { ok: false, error: "Income cannot be negative." };
  }

  const { monthlyMinor, annualMinor } = normalizeIncome(
    incomeAmountMinor,
    incomeFrequency,
  );

  const percentages = Object.fromEntries(
    allocationRows.map((row) => [row.allocation_type, Number(row.percentage)]),
  ) as AllocationPercentages;
  const targets = allocateAmounts(monthlyMinor, percentages);

  const { error: updateBudgetError } = await supabase
    .from("budgets")
    .update({
      income_amount_minor: incomeAmountMinor,
      normalized_monthly_income_minor: monthlyMinor,
      normalized_annual_income_minor: annualMinor,
      income_frequency: incomeFrequency,
    })
    .eq("id", budgetId);

  if (updateBudgetError) {
    return { ok: false, error: "Could not update the budget's income." };
  }

  for (const type of ALLOCATION_TYPES) {
    const { error } = await supabase
      .from("budget_allocations")
      .update({ target_amount_minor: targets[type] })
      .eq("budget_id", budgetId)
      .eq("allocation_type", type);
    if (error) {
      return { ok: false, error: "Could not recompute allocation targets." };
    }
  }

  revalidatePath("/budgets");
  revalidatePath(`/budgets/${budgetId}`);
  return { ok: true };
}

/** Replaces a budget's allocation percentages and recomputes every target_amount_minor from the budget's own normalized monthly income. */
export async function updateBudgetAllocations(
  budgetId: string,
  percentages: AllocationPercentages,
): Promise<SimpleActionResult> {
  const validation = validatePercentages(percentages);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const supabase = await supabaseSession();
  const { data: budget, error: budgetLookupError } = await supabase
    .from("budgets")
    .select("normalized_monthly_income_minor")
    .eq("id", budgetId)
    .maybeSingle();

  if (budgetLookupError || !budget) {
    return { ok: false, error: "Budget not found." };
  }

  const targets = allocateAmounts(
    BigInt(budget.normalized_monthly_income_minor),
    percentages,
  );

  for (const type of ALLOCATION_TYPES) {
    const { error } = await supabase
      .from("budget_allocations")
      .update({
        percentage: percentages[type],
        target_amount_minor: targets[type],
      })
      .eq("budget_id", budgetId)
      .eq("allocation_type", type);
    if (error) {
      return {
        ok: false,
        error: error.message.includes("100")
          ? "Active budgets must keep allocation percentages totaling exactly 100%."
          : "Could not update allocations.",
      };
    }
  }

  revalidatePath("/budgets");
  revalidatePath(`/budgets/${budgetId}`);
  return { ok: true };
}

/**
 * Activates a draft budget. Application-side pre-check gives a clean
 * error message; the validate_budget_activation trigger (see the Phase D
 * migration) is the actual database-level backstop that makes this
 * unbreakable even if this check were ever bypassed.
 */
export async function activateBudget(
  budgetId: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { data: allocationRows, error: lookupError } = await supabase
    .from("budget_allocations")
    .select("allocation_type, percentage")
    .eq("budget_id", budgetId);

  if (lookupError || !allocationRows || allocationRows.length !== 4) {
    return { ok: false, error: "Could not load the budget's allocations." };
  }

  const percentages = Object.fromEntries(
    allocationRows.map((row) => [row.allocation_type, Number(row.percentage)]),
  ) as AllocationPercentages;

  if (!isExactly100Percent(percentages)) {
    return {
      ok: false,
      error: "Allocation percentages must total exactly 100% before activating.",
    };
  }

  const { error } = await supabase
    .from("budgets")
    .update({ status: "active" })
    .eq("id", budgetId);

  if (error) {
    return {
      ok: false,
      error: error.message.includes("one active")
        ? "There is already an active budget in this currency. Archive or complete it first."
        : "Could not activate the budget.",
    };
  }

  revalidatePath("/budgets");
  revalidatePath(`/budgets/${budgetId}`);
  return { ok: true };
}

/** Archives a budget. Never deleted - historical figures remain reproducible. */
export async function archiveBudget(
  budgetId: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("budgets")
    .update({ status: "archived" })
    .eq("id", budgetId);

  if (error) {
    return { ok: false, error: "Could not archive the budget." };
  }

  revalidatePath("/budgets");
  revalidatePath(`/budgets/${budgetId}`);
  return { ok: true };
}

/**
 * Duplicates a budget (same currency/income/percentages) into a new draft
 * with the given period. Used both for an explicit "Duplicate" action and
 * for "Create next month" (the caller computes the next calendar month's
 * period_start/period_end and passes them through unchanged).
 */
export async function duplicateBudget(
  sourceBudgetId: string,
  periodStart: string,
  periodEnd: string,
): Promise<BudgetActionResult> {
  const supabase = await supabaseSession();
  const workspaceId = await getOwnedWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const source = await supabase
    .from("budgets")
    .select(
      "name, currency, income_amount_minor, normalized_monthly_income_minor, normalized_annual_income_minor, income_frequency, income_mode, template_id",
    )
    .eq("id", sourceBudgetId)
    .maybeSingle();

  if (
    source.error || !source.data ||
    !isSupportedCurrency(source.data.currency) ||
    !isIncomeFrequency(source.data.income_frequency)
  ) {
    return { ok: false, error: "Source budget not found." };
  }

  const sourceAllocations = await supabase
    .from("budget_allocations")
    .select("allocation_type, percentage")
    .eq("budget_id", sourceBudgetId);

  if (sourceAllocations.error || !sourceAllocations.data) {
    return { ok: false, error: "Could not load the source budget's allocations." };
  }

  const percentages = Object.fromEntries(
    sourceAllocations.data.map((row) => [
      row.allocation_type,
      Number(row.percentage),
    ]),
  ) as AllocationPercentages;

  return insertBudgetWithAllocations({
    workspaceId,
    templateId: source.data.template_id,
    name: source.data.name,
    currency: source.data.currency,
    periodStart,
    periodEnd,
    incomeAmountMinor: BigInt(source.data.income_amount_minor),
    monthlyIncomeMinor: BigInt(source.data.normalized_monthly_income_minor),
    annualIncomeMinor: BigInt(source.data.normalized_annual_income_minor),
    incomeFrequency: source.data.income_frequency,
    incomeMode: source.data.income_mode === "variable" ? "variable" : "fixed",
    percentages,
    sourceBudgetId,
  });
}

/**
 * Server-action wrapper around getVariableIncomeMonths() so the calculator
 * (a client component) can fetch this on demand - when the user switches
 * to variable-income mode, or changes currency while already in it -
 * rather than every currency's 3 months of candidate data being fetched
 * upfront on page load regardless of whether it's ever used.
 */
export async function fetchVariableIncomeMonths(
  currency: string,
): Promise<VariableIncomeMonth[]> {
  if (!isSupportedCurrency(currency)) return [];
  return getVariableIncomeMonths(currency);
}
