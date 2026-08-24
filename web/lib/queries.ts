import "server-only";
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
  settlement_state: string | null;
  affects_balance: boolean | null;
};

const TRANSACTION_COLUMNS =
  "id, transaction_type, direction, status, currency, amount_rwf, fee_rwf, net_effect_rwf, principal_effect_rwf, fee_effect_rwf, balance_after_rwf, counterparty_name, counterparty_reference, occurred_at, category, subcategory, category_source, settlement_state, affects_balance";

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
 * The signed-in user's own workspace_id, resolved from
 * workspace_memberships (RLS-scoped to rows the caller is actually a
 * member of - see is_workspace_member() and workspace_memberships_select_
 * member). Phase C has no team/multi-membership functionality yet, so a
 * user has exactly one active membership in practice; the owner role is
 * required for account/connection creation, so that role is what this
 * resolves.
 */
export async function getOwnedWorkspaceId(): Promise<string | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getOwnedWorkspaceId failed:", error.message);
    return null;
  }

  return data?.workspace_id ?? null;
}

/** The caller's workspace's default_currency, or "RWF" if it can't be resolved - used to pre-select a currency in the budget/goal creation forms. */
export async function getWorkspaceDefaultCurrency(): Promise<string> {
  const workspaceId = await getOwnedWorkspaceId();
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
