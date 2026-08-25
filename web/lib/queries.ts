import "server-only";
import { cookies } from "next/headers";
import { supabaseSession } from "./supabase-session-server";
import { kigaliDayBoundsUtc, kigaliDateKey } from "./kigali-time";
import {
  AllocationStatus,
  BudgetAlert,
  computeAllocationActual,
  computeBudgetAlerts,
  computeElapsedFraction,
} from "./budget-math";
import { findTransferCandidates, TransferCandidateTransaction } from "./transfer-detection";
import { lastNCompleteMonthKeys } from "./budget-math";

// Every function here queries through the session-authenticated Supabase
// client (lib/supabase-session-server.ts), never the service-role one -
// Phase B's actual security boundary is RLS, enforced by Postgres for
// whichever workspace(s) the signed-in user is a member of. There is
// deliberately no manual `.eq("workspace_id", ...)` filtering here: adding
// one would either duplicate what RLS already guarantees, or - if it were
// ever wrong - silently mask an RLS bug instead of surfacing it. If a
// caller isn't signed in, these queries simply return nothing (RLS denies
// unauthenticated access to every table here), never an error that could
// leak whether data exists.

export type TransactionRow = {
  id: string;
  transaction_type: string;
  direction: "in" | "out" | "neutral";
  status: string;
  currency: string;
  amount_rwf: number;
  fee_rwf: number;
  net_effect_rwf: number;
  principal_effect_rwf: number | null;
  fee_effect_rwf: number | null;
  balance_after_rwf: number | null;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  occurred_at: string;
  category: string | null;
  subcategory: string | null;
  category_source: string | null;
  category_confidence: number | null;
  category_decision_status: string;
  suggested_category: string | null;
  suggested_subcategory: string | null;
  settlement_state: string | null;
  affects_balance: boolean | null;
};

const TRANSACTION_COLUMNS =
  "id, transaction_type, direction, status, currency, amount_rwf, fee_rwf, net_effect_rwf, principal_effect_rwf, fee_effect_rwf, balance_after_rwf, counterparty_name, counterparty_reference, occurred_at, category, subcategory, category_source, category_confidence, category_decision_status, suggested_category, suggested_subcategory, settlement_state, affects_balance";

export async function getCurrentBalance(): Promise<number | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select("balance_after_rwf")
    .not("balance_after_rwf", "is", null)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getCurrentBalance failed:", error.message);
    return null;
  }

  return data?.balance_after_rwf ?? null;
}

export type TodayTotals = {
  spentRwf: number;
  receivedRwf: number;
};

export async function getTodayTotals(): Promise<TodayTotals> {
  const supabase = await supabaseSession();
  const todayKey = kigaliDateKey(new Date().toISOString());
  const { startUtc, endUtc } = kigaliDayBoundsUtc(todayKey);

  const { data, error } = await supabase
    .from("transactions")
    .select("direction, principal_effect_rwf, fee_effect_rwf")
    .eq("settlement_state", "settled")
    .gte("occurred_at", startUtc.toISOString())
    .lte("occurred_at", endUtc.toISOString());

  if (error) {
    console.error("getTodayTotals failed:", error.message);
    return { spentRwf: 0, receivedRwf: 0 };
  }

  let spentRwf = 0;
  let receivedRwf = 0;

  for (const row of data ?? []) {
    const effect = Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf);
    if (row.direction === "out") {
      spentRwf += Math.abs(effect);
    } else if (row.direction === "in") {
      receivedRwf += effect;
    }
  }

  return { spentRwf, receivedRwf };
}

export async function getRecentTransactions(
  limit = 8,
): Promise<TransactionRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getRecentTransactions failed:", error.message);
    return [];
  }

  return data ?? [];
}

export async function getTransactions(
  {
    limit = 50,
    offset = 0,
    category,
  }: { limit?: number; offset?: number; category?: string } = {},
): Promise<TransactionRow[]> {
  const supabase = await supabaseSession();
  let query = supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (category === "Uncategorized") {
    query = query.is("category", null);
  } else if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    console.error("getTransactions failed:", error.message);
    return [];
  }

  return data ?? [];
}

const REVIEW_QUEUE_STATUSES = ["provisional", "suggested", "conflict"] as const;
const REVIEW_QUEUE_LIMIT = 100;

// Unlike most reads in this file, review-queue rows are read through RLS
// alone (no active-workspace filter) - same as getTransactions/
// getTransactionById above - since a review item belongs to whichever
// workspace its transaction does, and RLS already scopes that correctly
// per-row.
export async function getReviewQueueTransactions(): Promise<TransactionRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .in("category_decision_status", REVIEW_QUEUE_STATUSES)
    .order("occurred_at", { ascending: false })
    .limit(REVIEW_QUEUE_LIMIT);

  if (error) {
    console.error("getReviewQueueTransactions failed:", error.message);
    return [];
  }

  return data ?? [];
}

export async function getReviewQueueCount(): Promise<number> {
  const supabase = await supabaseSession();
  const { count, error } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .in("category_decision_status", REVIEW_QUEUE_STATUSES);

  if (error) {
    console.error("getReviewQueueCount failed:", error.message);
    return 0;
  }

  return count ?? 0;
}

export async function getTransactionById(
  id: string,
): Promise<TransactionRow | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getTransactionById failed:", error.message);
    return null;
  }

  return data;
}

export type CategoryTotal = {
  category: string; // "Uncategorized" for null
  totalRwf: number;
  transactionCount: number;
};

export async function getCategoryTotals(): Promise<CategoryTotal[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select("category, principal_effect_rwf, fee_effect_rwf")
    .eq("direction", "out")
    .eq("settlement_state", "settled");

  if (error) {
    console.error("getCategoryTotals failed:", error.message);
    return [];
  }

  const totals = new Map<string, { total: number; count: number }>();

  for (const row of data ?? []) {
    const key = row.category ?? "Uncategorized";
    const effect = Math.abs(
      Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf),
    );
    const existing = totals.get(key) ?? { total: 0, count: 0 };
    totals.set(key, { total: existing.total + effect, count: existing.count + 1 });
  }

  return Array.from(totals.entries())
    .map(([category, { total, count }]) => ({
      category,
      totalRwf: total,
      transactionCount: count,
    }))
    .sort((a, b) => b.totalRwf - a.totalRwf);
}

/**
 * The workspace every workspace-scoped read/write in this app should use
 * for the current request - the caller's explicitly chosen workspace if
 * they've switched to one via the workspace switcher (AppShell's
 * WorkspaceSwitcher, `setActiveWorkspace` in
 * app/settings/workspace/actions.ts), otherwise their personal workspace.
 * A user now belongs to any number of workspaces (their own personal one
 * plus any organization they own or were invited into - see
 * supabase/migrations/20260827000000_organization_workspaces.sql), so
 * unlike the single-workspace assumption this replaced, "the caller's
 * workspace" is no longer unambiguous without this resolution.
 */
export async function getActiveWorkspaceId(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = await supabaseSession();
  const requestedId = cookieStore.get("active_workspace_id")?.value;

  if (requestedId) {
    const { data } = await supabase
      .from("workspace_memberships")
      .select("workspace_id")
      .eq("workspace_id", requestedId)
      .eq("status", "active")
      .maybeSingle();

    if (data?.workspace_id) return data.workspace_id;
  }

  // No cookie, or it named a workspace the caller is no longer an active
  // member of - fall back to their personal workspace, which always
  // exists exactly once per user (handle_new_user()).
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("workspace_id, workspaces!inner(kind)")
    .eq("status", "active")
    .eq("workspaces.kind", "personal")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getActiveWorkspaceId failed:", error.message);
    return null;
  }

  return data?.workspace_id ?? null;
}

/** The caller's active workspace's default_currency, or "RWF" if it can't be resolved - used to pre-select a currency in the budget/goal creation forms. */
export async function getWorkspaceDefaultCurrency(): Promise<string> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return "RWF";
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("workspaces")
    .select("default_currency")
    .eq("id", workspaceId)
    .maybeSingle();
  return data?.default_currency ?? "RWF";
}

export type AccountRow = {
  id: string;
  name: string;
  provider: string;
  currency: string;
  is_active: boolean;
  is_primary: boolean;
  archived_at: string | null;
};

export async function getAccounts(): Promise<AccountRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, provider, currency, is_active, is_primary, archived_at")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getAccounts failed:", error.message);
    return [];
  }

  return data ?? [];
}

export type IngestionConnectionRow = {
  id: string;
  label: string;
  provider: string;
  status: "active" | "revoked";
  credential_prefix: string;
  last_used_at: string | null;
  created_at: string;
  account_id: string;
  account_name: string;
};

export async function getIngestionConnections(): Promise<
  IngestionConnectionRow[]
> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("ingestion_connections")
    .select(
      // Two FKs link ingestion_connections to accounts (the plain account_id
      // one, and the composite ingestion_connections_account_same_workspace
      // one used only to guarantee same-workspace routing at the database
      // level) - the embed must name the single-column FK explicitly or
      // PostgREST cannot pick one automatically.
      "id, label, provider, status, credential_prefix, last_used_at, created_at, account_id, accounts!ingestion_connections_account_id_fkey(name)",
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getIngestionConnections failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const account = row.accounts as unknown as { name: string } | null;
    return {
      id: row.id,
      label: row.label,
      provider: row.provider,
      status: row.status,
      credential_prefix: row.credential_prefix,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      account_id: row.account_id,
      account_name: account?.name ?? "Unknown account",
    };
  });
}

// ===========================================================================
// Phase D: budgets, allocations, category mappings, goals.
// ===========================================================================

export type AllocationType = "ESSENTIALS" | "INVESTING" | "EMERGENCY" | "WANTS";

export type TemplateAllocation = {
  allocation_type: AllocationType;
  percentage: number;
  sort_order: number;
};

export type SystemTemplate = {
  id: string;
  name: string;
  description: string | null;
  allocations: TemplateAllocation[];
};

/** The single active system template (50/15/5/30). Global, not workspace-scoped. */
export async function getSystemTemplate(): Promise<SystemTemplate | null> {
  const supabase = await supabaseSession();
  const { data: template, error: templateError } = await supabase
    .from("budget_templates")
    .select("id, name, description")
    .eq("is_system_template", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (templateError || !template) {
    if (templateError) console.error("getSystemTemplate failed:", templateError.message);
    return null;
  }

  const { data: allocations, error: allocationsError } = await supabase
    .from("budget_template_allocations")
    .select("allocation_type, percentage, sort_order")
    .eq("template_id", template.id)
    .order("sort_order", { ascending: true });

  if (allocationsError) {
    console.error("getSystemTemplate allocations failed:", allocationsError.message);
    return null;
  }

  return { ...template, allocations: allocations ?? [] };
}

export type BudgetRow = {
  id: string;
  name: string;
  currency: string;
  period_start: string;
  period_end: string;
  income_amount_minor: number;
  normalized_monthly_income_minor: number;
  normalized_annual_income_minor: number;
  income_frequency: string;
  income_mode: string;
  status: "draft" | "active" | "completed" | "archived";
  created_at: string;
  activated_at: string | null;
};

const BUDGET_COLUMNS =
  "id, name, currency, period_start, period_end, income_amount_minor, normalized_monthly_income_minor, normalized_annual_income_minor, income_frequency, income_mode, status, created_at, activated_at";

export async function getBudgets(): Promise<BudgetRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("budgets")
    .select(BUDGET_COLUMNS)
    .order("status", { ascending: true })
    .order("period_start", { ascending: false });

  if (error) {
    console.error("getBudgets failed:", error.message);
    return [];
  }

  return data ?? [];
}

export type BudgetAllocationRow = {
  id: string;
  allocation_type: AllocationType;
  percentage: number;
  target_amount_minor: number;
  sort_order: number;
};

export type BudgetWithAllocations = BudgetRow & {
  allocations: BudgetAllocationRow[];
};

export async function getBudgetById(
  id: string,
): Promise<BudgetWithAllocations | null> {
  const supabase = await supabaseSession();
  const { data: budget, error: budgetError } = await supabase
    .from("budgets")
    .select(BUDGET_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (budgetError || !budget) {
    if (budgetError) console.error("getBudgetById failed:", budgetError.message);
    return null;
  }

  const { data: allocations, error: allocationsError } = await supabase
    .from("budget_allocations")
    .select("id, allocation_type, percentage, target_amount_minor, sort_order")
    .eq("budget_id", id)
    .order("sort_order", { ascending: true });

  if (allocationsError) {
    console.error("getBudgetById allocations failed:", allocationsError.message);
    return null;
  }

  return { ...budget, allocations: allocations ?? [] };
}

export type CategoryMappingRow = {
  category: string;
  allocationType: AllocationType | null;
  transactionCount: number;
  totalRwf: number;
};

/**
 * Every distinct spending category currently in use (settled, direction
 * out), alongside its currently-open budget_category_mappings row (if
 * any). RWF-denominated totals only - see the Phase D migration's own
 * note on why transaction actuals only ever exist for RWF today.
 */
export async function getCategoryMappings(): Promise<CategoryMappingRow[]> {
  const supabase = await supabaseSession();

  const [txnsResult, mappingsResult] = await Promise.all([
    supabase
      .from("transactions")
      .select("category, principal_effect_rwf, fee_effect_rwf")
      .not("category", "is", null)
      .eq("direction", "out")
      .eq("settlement_state", "settled"),
    supabase
      .from("budget_category_mappings")
      .select("category, allocation_type")
      .is("effective_until", null),
  ]);

  if (txnsResult.error) {
    console.error("getCategoryMappings transactions failed:", txnsResult.error.message);
    return [];
  }
  if (mappingsResult.error) {
    console.error("getCategoryMappings mappings failed:", mappingsResult.error.message);
  }

  const mappingByCategory = new Map<string, AllocationType>();
  for (const row of mappingsResult.data ?? []) {
    mappingByCategory.set(row.category, row.allocation_type as AllocationType);
  }

  const totals = new Map<string, { total: number; count: number }>();
  for (const row of txnsResult.data ?? []) {
    const category = row.category as string;
    const effect = Math.abs(Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf));
    const existing = totals.get(category) ?? { total: 0, count: 0 };
    totals.set(category, { total: existing.total + effect, count: existing.count + 1 });
  }

  return Array.from(totals.entries())
    .map(([category, { total, count }]) => ({
      category,
      allocationType: mappingByCategory.get(category) ?? null,
      transactionCount: count,
      totalRwf: total,
    }))
    .sort((a, b) => b.totalRwf - a.totalRwf);
}

export type { AllocationStatus };

export type AllocationActual = {
  allocationType: AllocationType;
  targetMinor: number;
  actualMinor: number;
  remainingMinor: number;
  /** null only when targetMinor is 0 and there is spending against it - a percentage is meaningless there. */
  percentConsumed: number | null;
  /** null unless the budget is active and today falls within its period. */
  projectedMinor: number | null;
  status: AllocationStatus;
};

export type BudgetActuals = {
  allocations: AllocationActual[];
  actualIncomeMinor: number;
  unmappedMinor: number;
  unmappedCount: number;
  uncategorizedMinor: number;
  uncategorizedCount: number;
  /** Fraction (0-1) of the budget period elapsed so far, or null if the period doesn't cover today / the budget isn't active. */
  elapsedFraction: number | null;
  alerts: BudgetAlert[];
};

/**
 * Aggregates a budget's actual income/spending from transactions,
 * mapped to allocations through budget_category_mappings. Mapping lookup
 * is effective-dated per transaction (not per budget period) - a later
 * remap never changes how an already-recorded transaction was
 * classified at the time it occurred, keeping historical periods
 * reproducible (see the Phase D migration's own comments on
 * budget_category_mappings).
 */
export async function getBudgetActuals(
  budget: BudgetWithAllocations,
): Promise<BudgetActuals> {
  const supabase = await supabaseSession();
  const { startUtc } = kigaliDayBoundsUtc(budget.period_start);
  const { endUtc } = kigaliDayBoundsUtc(budget.period_end);

  const [outResult, inResult, mappingsResult, transferLinksResult, splitsResult] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, category, principal_effect_rwf, fee_effect_rwf, occurred_at")
      .eq("currency", budget.currency)
      .eq("direction", "out")
      .eq("settlement_state", "settled")
      .gte("occurred_at", startUtc.toISOString())
      .lte("occurred_at", endUtc.toISOString()),
    supabase
      .from("transactions")
      .select("id, principal_effect_rwf, fee_effect_rwf")
      .eq("currency", budget.currency)
      .eq("direction", "in")
      .eq("settlement_state", "settled")
      .gte("occurred_at", startUtc.toISOString())
      .lte("occurred_at", endUtc.toISOString()),
    supabase
      .from("budget_category_mappings")
      .select("category, allocation_type, effective_from, effective_until"),
    supabase
      .from("transfer_links")
      .select("out_transaction_id, in_transaction_id")
      .eq("status", "linked"),
    supabase
      .from("transaction_splits")
      .select("transaction_id, allocation_type, amount_minor"),
  ]);

  if (outResult.error) console.error("getBudgetActuals (out) failed:", outResult.error.message);
  if (inResult.error) console.error("getBudgetActuals (in) failed:", inResult.error.message);
  if (mappingsResult.error) console.error("getBudgetActuals (mappings) failed:", mappingsResult.error.message);
  if (transferLinksResult.error) console.error("getBudgetActuals (transfer links) failed:", transferLinksResult.error.message);
  if (splitsResult.error) console.error("getBudgetActuals (splits) failed:", splitsResult.error.message);

  const splitsByTransaction = new Map<string, { allocation_type: AllocationType; amount_minor: number }[]>();
  for (const row of splitsResult.data ?? []) {
    const existing = splitsByTransaction.get(row.transaction_id) ?? [];
    existing.push({ allocation_type: row.allocation_type as AllocationType, amount_minor: row.amount_minor });
    splitsByTransaction.set(row.transaction_id, existing);
  }

  // Confirmed self-transfers move money between the user's own accounts -
  // never expenditure or income (see the master prompt's own rule, and
  // transfer_links' comment in the Phase E migration).
  const linkedOutIds = new Set((transferLinksResult.data ?? []).map((l) => l.out_transaction_id));
  const linkedInIds = new Set((transferLinksResult.data ?? []).map((l) => l.in_transaction_id));
  const outRows = (outResult.data ?? []).filter((row) => !linkedOutIds.has(row.id));
  const inRows = (inResult.data ?? []).filter((row) => !linkedInIds.has(row.id));

  const actualIncomeMinor = inRows.reduce(
    (sum, row) => sum + Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf),
    0,
  );

  const totalsByAllocation = new Map<AllocationType, number>();
  let unmappedMinor = 0;
  let unmappedCount = 0;
  let uncategorizedMinor = 0;
  let uncategorizedCount = 0;

  for (const row of outRows) {
    const effect = Math.abs(Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf));

    // A split transaction is governed entirely by its own split rows -
    // never by category mapping, even if it also has a mapped category.
    // See transaction_splits' own comment in the Phase E migration.
    const splits = splitsByTransaction.get(row.id);
    if (splits && splits.length > 0) {
      for (const split of splits) {
        totalsByAllocation.set(
          split.allocation_type,
          (totalsByAllocation.get(split.allocation_type) ?? 0) + split.amount_minor,
        );
      }
      continue;
    }

    if (!row.category) {
      uncategorizedMinor += effect;
      uncategorizedCount += 1;
      continue;
    }

    const txnDateKey = kigaliDateKey(row.occurred_at);
    const mapping = (mappingsResult.data ?? []).find((m) =>
      m.category === row.category &&
      m.effective_from <= txnDateKey &&
      (m.effective_until === null || m.effective_until >= txnDateKey)
    );

    if (!mapping) {
      unmappedMinor += effect;
      unmappedCount += 1;
      continue;
    }

    const allocationType = mapping.allocation_type as AllocationType;
    totalsByAllocation.set(
      allocationType,
      (totalsByAllocation.get(allocationType) ?? 0) + effect,
    );
  }

  const todayKey = kigaliDateKey(new Date().toISOString());
  const elapsedFraction = computeElapsedFraction(
    budget.period_start,
    budget.period_end,
    todayKey,
    budget.status === "active",
  );

  const allocations: AllocationActual[] = budget.allocations.map((a) => {
    const actualMinor = totalsByAllocation.get(a.allocation_type) ?? 0;
    const targetMinor = a.target_amount_minor;
    const math = computeAllocationActual(
      BigInt(actualMinor),
      BigInt(targetMinor),
      elapsedFraction,
    );

    return {
      allocationType: a.allocation_type,
      targetMinor,
      actualMinor,
      remainingMinor: Number(math.remainingMinor),
      percentConsumed: math.percentConsumed,
      projectedMinor: math.projectedMinor !== null ? Number(math.projectedMinor) : null,
      status: math.status,
    };
  });

  const alerts = computeBudgetAlerts({
    allocations: allocations.map((a) => ({
      allocationType: a.allocationType,
      actualMinor: BigInt(a.actualMinor),
      targetMinor: BigInt(a.targetMinor),
      status: a.status,
    })),
    unmappedCount,
    unmappedMinor: BigInt(unmappedMinor),
    uncategorizedCount,
    uncategorizedMinor: BigInt(uncategorizedMinor),
    budgetedIncomeMinor: BigInt(budget.normalized_monthly_income_minor),
    actualIncomeMinor: BigInt(actualIncomeMinor),
    elapsedFraction,
  });

  return {
    allocations,
    actualIncomeMinor,
    unmappedMinor,
    unmappedCount,
    uncategorizedMinor,
    uncategorizedCount,
    elapsedFraction,
    alerts,
  };
}

// ===========================================================================
// Financial goals
// ===========================================================================

export type GoalType =
  | "emergency_fund"
  | "investing"
  | "planned_purchase"
  | "debt"
  | "general_savings";

export type GoalRow = {
  id: string;
  goal_type: GoalType;
  name: string;
  description: string | null;
  currency: string;
  target_amount_minor: number;
  current_amount_minor: number;
  target_date: string | null;
  status: "active" | "completed" | "archived";
  created_at: string;
  completed_at: string | null;
};

const GOAL_COLUMNS =
  "id, goal_type, name, description, currency, target_amount_minor, current_amount_minor, target_date, status, created_at, completed_at";

export async function getGoals(): Promise<GoalRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("financial_goals")
    .select(GOAL_COLUMNS)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getGoals failed:", error.message);
    return [];
  }

  return data ?? [];
}

export type GoalContributionRow = {
  id: string;
  amount_minor: number;
  contribution_date: string;
  source: "manual" | "transaction_link";
  transaction_id: string | null;
  created_at: string;
};

export type GoalWithContributions = GoalRow & {
  contributions: GoalContributionRow[];
};

export async function getGoalById(id: string): Promise<GoalWithContributions | null> {
  const supabase = await supabaseSession();
  const { data: goal, error: goalError } = await supabase
    .from("financial_goals")
    .select(GOAL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (goalError || !goal) {
    if (goalError) console.error("getGoalById failed:", goalError.message);
    return null;
  }

  const { data: contributions, error: contributionsError } = await supabase
    .from("goal_contributions")
    .select("id, amount_minor, contribution_date, source, transaction_id, created_at")
    .eq("goal_id", id)
    .order("contribution_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (contributionsError) {
    console.error("getGoalById contributions failed:", contributionsError.message);
    return null;
  }

  return { ...goal, contributions: contributions ?? [] };
}

// ===========================================================================
// Self-transfer detection
// ===========================================================================

const TRANSFER_LOOKBACK_DAYS = 60;

export type TransferCandidateDisplay = {
  outTransactionId: string;
  outAccountName: string;
  outOccurredAt: string;
  inTransactionId: string;
  inAccountName: string;
  inOccurredAt: string;
  amountMinor: number;
  currency: string;
  amountDiffPercent: number;
  hoursApart: number;
};

/**
 * Heuristic self-transfer suggestions - see web/lib/transfer-detection.ts
 * for the matching algorithm itself. Bounded to the last 60 days (not the
 * whole transaction history) and excludes any transaction already present
 * in transfer_links (linked OR dismissed) so a reviewed transaction is
 * never re-suggested.
 */
export async function getTransferCandidates(): Promise<TransferCandidateDisplay[]> {
  const supabase = await supabaseSession();
  const sinceIso = new Date(Date.now() - TRANSFER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [txnsResult, reviewedResult] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        "id, account_id, direction, currency, principal_effect_rwf, occurred_at, accounts!transactions_account_id_fkey(name)",
      )
      .in("direction", ["in", "out"])
      .eq("settlement_state", "settled")
      .gte("occurred_at", sinceIso),
    supabase.from("transfer_links").select("out_transaction_id, in_transaction_id"),
  ]);

  if (txnsResult.error) {
    console.error("getTransferCandidates failed:", txnsResult.error.message);
    return [];
  }
  if (reviewedResult.error) {
    console.error("getTransferCandidates (reviewed) failed:", reviewedResult.error.message);
  }

  const reviewedIds = new Set<string>();
  for (const row of reviewedResult.data ?? []) {
    reviewedIds.add(row.out_transaction_id);
    reviewedIds.add(row.in_transaction_id);
  }

  type Row = {
    id: string;
    account_id: string;
    direction: "in" | "out";
    currency: string;
    principal_effect_rwf: number | null;
    occurred_at: string;
    accounts: { name: string } | null;
  };

  const eligible = (txnsResult.data as unknown as Row[]).filter(
    (row) => !reviewedIds.has(row.id) && row.principal_effect_rwf !== null,
  );

  const forMatching: TransferCandidateTransaction[] = eligible.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    direction: row.direction,
    amountMinor: BigInt(Math.abs(row.principal_effect_rwf!)),
    occurredAt: row.occurred_at,
    currency: row.currency,
  }));

  const byId = new Map(eligible.map((row) => [row.id, row]));
  const candidates = findTransferCandidates(forMatching);

  return candidates.map((c) => {
    const out = byId.get(c.outTransactionId)!;
    const incoming = byId.get(c.inTransactionId)!;
    return {
      outTransactionId: c.outTransactionId,
      outAccountName: out.accounts?.name ?? "Unknown account",
      outOccurredAt: out.occurred_at,
      inTransactionId: c.inTransactionId,
      inAccountName: incoming.accounts?.name ?? "Unknown account",
      inOccurredAt: incoming.occurred_at,
      amountMinor: Math.abs(out.principal_effect_rwf!),
      currency: out.currency,
      amountDiffPercent: c.amountDiffPercent,
      hoursApart: c.hoursApart,
    };
  });
}

export type LinkedTransferRow = {
  id: string;
  out_transaction_id: string;
  in_transaction_id: string;
  status: "linked" | "dismissed";
  created_at: string;
};

export async function getTransferLinks(): Promise<LinkedTransferRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transfer_links")
    .select("id, out_transaction_id, in_transaction_id, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getTransferLinks failed:", error.message);
    return [];
  }

  return data ?? [];
}

// ===========================================================================
// Transaction splits
// ===========================================================================

export type TransactionSplitRow = {
  id: string;
  allocation_type: AllocationType;
  amount_minor: number;
};

export type CategoryHistoryEntry = {
  id: string;
  previous_category: string | null;
  new_category: string | null;
  new_category_source: string;
  decision_reason: string | null;
  actor_type: string;
  created_at: string;
};

// RLS (transaction_category_history_select_member, see
// 20260829000000_phase_f_categorization_policies.sql) is what actually
// scopes this to the caller's own workspace - most-recent first, so the
// transaction detail page can show the latest decision's explanation
// without a second round trip.
export async function getCategoryHistory(
  transactionId: string,
): Promise<CategoryHistoryEntry[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transaction_category_history")
    .select(
      "id, previous_category, new_category, new_category_source, decision_reason, actor_type, created_at",
    )
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getCategoryHistory failed:", error.message);
    return [];
  }

  return data ?? [];
}

const CATEGORIZATION_POLICY_COLUMNS =
  "id, name, description, category, subcategory, match_type, merchant_pattern, direction, amount_min_rwf, amount_max_rwf, time_start, time_end, priority, is_active, rule_source, confidence, usage_count, last_used_at";

export type CategorizationPolicyRow = {
  id: string;
  name: string | null;
  description: string | null;
  category: string;
  subcategory: string | null;
  match_type: string;
  merchant_pattern: string | null;
  direction: "in" | "out" | "neutral" | null;
  amount_min_rwf: number | null;
  amount_max_rwf: number | null;
  time_start: string | null;
  time_end: string | null;
  priority: number;
  is_active: boolean;
  rule_source: string;
  confidence: number;
  usage_count: number;
  last_used_at: string | null;
};

// Unlike most reads in this file, policies genuinely need explicit
// active-workspace scoping (not just RLS) - a user who belongs to more
// than one workspace (organization membership) would otherwise see every
// workspace's rules mixed into one list, and RLS alone would still permit
// editing a rule outside the workspace the user is currently viewing.
// Same reasoning budget_category_mappings' actions already use
// getActiveWorkspaceId() for.
export async function getCategorizationPolicies(): Promise<CategorizationPolicyRow[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return [];
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("categorization_policies")
    .select(CATEGORIZATION_POLICY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("priority", { ascending: true });

  if (error) {
    console.error("getCategorizationPolicies failed:", error.message);
    return [];
  }

  return data ?? [];
}

export async function getCategorizationPolicyById(
  id: string,
): Promise<CategorizationPolicyRow | null> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return null;
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("categorization_policies")
    .select(CATEGORIZATION_POLICY_COLUMNS)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getCategorizationPolicyById failed:", error.message);
    return null;
  }

  return data;
}

export async function getTransactionSplits(
  transactionId: string,
): Promise<TransactionSplitRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transaction_splits")
    .select("id, allocation_type, amount_minor")
    .eq("transaction_id", transactionId)
    .order("allocation_type", { ascending: true });

  if (error) {
    console.error("getTransactionSplits failed:", error.message);
    return [];
  }

  return data ?? [];
}

// ===========================================================================
// Variable income: candidate transactions for the previous 3 complete
// months, for a workspace-owner to inspect/exclude before accepting a
// recommended baseline (see web/lib/budget-math.ts for the actual
// averaging/minimum logic).
// ===========================================================================

export type VariableIncomeTransaction = {
  id: string;
  occurredAt: string;
  counterpartyName: string | null;
  amountMinor: number;
};

export type VariableIncomeMonth = {
  monthKey: string;
  transactions: VariableIncomeTransaction[];
};

function lastDayOfMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Complete calendar months are Kigali-calendar months entirely before
 * the current one - the current, still-in-progress month is never
 * included (matching the product spec's own "previous 3 complete
 * months" wording). Months with zero qualifying transactions are simply
 * absent from the result, not included as an empty/zero entry - callers
 * feed only the months with actual data into
 * computeVariableIncomeRecommendation().
 */
export async function getVariableIncomeMonths(
  currency: string,
  monthsBack = 3,
): Promise<VariableIncomeMonth[]> {
  const supabase = await supabaseSession();
  const todayMonthKey = kigaliDateKey(new Date().toISOString()).slice(0, 7);
  const monthKeys = lastNCompleteMonthKeys(todayMonthKey, monthsBack);
  if (monthKeys.length === 0) return [];

  const firstMonthKey = monthKeys[0];
  const lastMonthKey = monthKeys[monthKeys.length - 1];
  const { startUtc } = kigaliDayBoundsUtc(`${firstMonthKey}-01`);
  const { endUtc } = kigaliDayBoundsUtc(
    `${lastMonthKey}-${String(lastDayOfMonth(lastMonthKey)).padStart(2, "0")}`,
  );

  const { data, error } = await supabase
    .from("transactions")
    .select("id, occurred_at, counterparty_name, principal_effect_rwf, fee_effect_rwf")
    .eq("currency", currency)
    .eq("direction", "in")
    .eq("settlement_state", "settled")
    .gte("occurred_at", startUtc.toISOString())
    .lte("occurred_at", endUtc.toISOString())
    .order("occurred_at", { ascending: true });

  if (error) {
    console.error("getVariableIncomeMonths failed:", error.message);
    return [];
  }

  const byMonth = new Map<string, VariableIncomeTransaction[]>();
  for (const row of data ?? []) {
    const monthKey = kigaliDateKey(row.occurred_at).slice(0, 7);
    if (!monthKeys.includes(monthKey)) continue; // defensive: excludes any boundary row outside the intended months
    const amountMinor = Math.abs(Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf));
    const existing = byMonth.get(monthKey) ?? [];
    existing.push({ id: row.id, occurredAt: row.occurred_at, counterpartyName: row.counterparty_name, amountMinor });
    byMonth.set(monthKey, existing);
  }

  return monthKeys
    .filter((key) => byMonth.has(key))
    .map((monthKey) => ({ monthKey, transactions: byMonth.get(monthKey)! }));
}

// ===========================================================================
// Organization workspaces: creation, membership, invites. See
// supabase/migrations/20260827000000_organization_workspaces.sql.
// ===========================================================================

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type WorkspaceSummary = {
  id: string;
  name: string;
  kind: "personal" | "organization";
  role: WorkspaceRole;
};

/** Every workspace the caller is an active member of - drives the workspace switcher. */
export async function getUserWorkspaces(): Promise<WorkspaceSummary[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("role, workspaces(id, name, kind)")
    .eq("status", "active")
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("getUserWorkspaces failed:", error.message);
    return [];
  }

  return (data ?? []).flatMap((row) => {
    const workspace = row.workspaces as unknown as
      | { id: string; name: string; kind: "personal" | "organization" }
      | null;
    if (!workspace) return [];
    return [
      { id: workspace.id, name: workspace.name, kind: workspace.kind, role: row.role },
    ] as WorkspaceSummary[];
  });
}

/** The active workspace's own id/name/kind/the caller's role in it - for the workspace settings page and the switcher's current-selection label. */
export async function getActiveWorkspace(): Promise<WorkspaceSummary | null> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return null;

  const workspaces = await getUserWorkspaces();
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

export type WorkspaceMemberRow = {
  membershipId: string;
  userId: string;
  role: WorkspaceRole;
  status: "invited" | "active" | "suspended" | "removed";
  joinedAt: string | null;
  isSelf: boolean;
};

/**
 * Active workspace's member list. No email/display-name is surfaced here -
 * profiles is RLS-scoped to `id = auth.uid()` (profiles_select_own), so a
 * plain authenticated query can only ever see the caller's own profile
 * row, not other members'. Showing names/emails for other members would
 * need a dedicated SECURITY DEFINER directory function; deferred until
 * that's actually needed rather than building it speculatively now.
 */
export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberRow[]> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("id, user_id, role, status, joined_at")
    .eq("workspace_id", workspaceId)
    .neq("status", "removed")
    .order("role", { ascending: true })
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("getWorkspaceMembers failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    membershipId: row.id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    isSelf: row.user_id === user?.id,
  }));
}

export type WorkspaceInviteRow = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string;
};

export async function getWorkspaceInvites(
  workspaceId: string,
): Promise<WorkspaceInviteRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("workspace_invites")
    .select("id, email, role, status, token_prefix, created_at, expires_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getWorkspaceInvites failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}
