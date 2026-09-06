import "server-only";
import { cookies } from "next/headers";
import { supabaseSession } from "./supabase-session-server";
import { kigaliDayBoundsUtc, kigaliDateKey } from "./kigali-time";
import {
  aggregateOutflowsByAllocation,
  ALLOCATION_TYPES,
  AllocationStatus,
  BudgetAlert,
  computeAllocationActual,
  computeBudgetAlerts,
  computeElapsedFraction,
  daysBetweenDateKeys,
} from "./budget-math";
import {
  buildCanonicalConnectorReadModel,
  type ConnectorAdapterCanaryStatus,
  type CanonicalConnectorInstallation,
  type ConnectorAccountRecord,
  type ConnectorInstallationRecord,
  type ConnectorSourceRecord,
  type DeviceCredentialRecord,
} from "./connector-read-model";
export type { ConnectorAdapterCanaryStatus } from "./connector-read-model";

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

export type CurrentBalance = {
  amountRwf: number;
  /** occurred_at of the transaction this balance is derived from - the
   *  natural "as of" freshness signal (master prompt §7/§11.4): this
   *  balance is only ever as current as the most recent transaction
   *  MoMo has reported, not a live account-level query. */
  asOfIso: string;
};

export async function getCurrentBalance(): Promise<CurrentBalance | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select("balance_after_rwf, occurred_at")
    .not("balance_after_rwf", "is", null)
    // Phase U: a transaction merged into its canonical duplicate is kept
    // for evidence but is never a live transaction - here it must not be
    // mistaken for the latest balance snapshot.
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getCurrentBalance failed:", error.message);
    return null;
  }

  if (!data) return null;

  return { amountRwf: data.balance_after_rwf, asOfIso: data.occurred_at };
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
    // Phase U: exclude rows merged into a canonical duplicate (kept for
    // evidence, never counted).
    .neq("dedupe_state", "merged")
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
    // Phase U: merged duplicates stay in the DB as evidence but never in a
    // ledger listing.
    .neq("dedupe_state", "merged")
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
    // Phase U: merged duplicates stay in the DB as evidence but never in a
    // ledger listing.
    .neq("dedupe_state", "merged")
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

// ===========================================================================
// Space provenance + attribution for one transaction (household ledger).
// See Phase Q/S migrations: transactions gained financial_source_id /
// performed_by_user_id / attribution_type / attributed_user_id /
// allocation_status; 20260914000000 added set_transaction_attribution and
// transaction_member_attributions; 20260915000000 added
// space_member_directory (co-member display names past profiles' own RLS).
// ===========================================================================

export type SpaceMember = {
  userId: string;
  displayName: string | null;
  role: WorkspaceRole;
};

/** Active members of a Space, with display names - only if the caller is a member. */
export async function getSpaceMemberDirectory(
  workspaceId: string,
): Promise<SpaceMember[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("space_member_directory", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    console.error("getSpaceMemberDirectory failed:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    user_id: string;
    display_name: string | null;
    role: WorkspaceRole;
  }>).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
  }));
}

/** The signed-in user's id, or null. */
export async function getAuthUserId(): Promise<string | null> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export type TransactionAttributionType =
  | "shared"
  | "member"
  | "split"
  | "unassigned";

export type TransactionSpaceContext = {
  workspaceId: string;
  workspaceName: string | null;
  workspaceKind: WorkspaceKind;
  sourceName: string | null;
  sourceProvider: string | null;
  sourceMaskedIdentifier: string | null;
  sourceOwnerUserId: string | null;
  performedByUserId: string | null;
  recordCreatedByUserId: string | null;
  ingestionConnectionLabel: string | null;
  attributionType: TransactionAttributionType | null;
  attributedUserId: string | null;
  allocationStatus: "allocated" | "needs_space" | "needs_attribution";
  memberSplits: Array<{ userId: string; shareBps: number }>;
};

export async function getTransactionSpaceContext(
  id: string,
): Promise<TransactionSpaceContext | null> {
  const supabase = await supabaseSession();

  const { data, error } = await supabase
    .from("transactions")
    .select(
      "workspace_id, performed_by_user_id, record_created_by_user_id, attribution_type, attributed_user_id, allocation_status, workspaces(name, kind), financial_sources(display_name, provider, masked_identifier, owner_user_id), ingestion_connections(label)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("getTransactionSpaceContext failed:", error.message);
    return null;
  }

  const row = data as unknown as {
    workspace_id: string;
    performed_by_user_id: string | null;
    record_created_by_user_id: string | null;
    attribution_type: TransactionAttributionType | null;
    attributed_user_id: string | null;
    allocation_status: "allocated" | "needs_space" | "needs_attribution";
    workspaces: { name: string; kind: WorkspaceKind } | null;
    financial_sources: {
      display_name: string;
      provider: string;
      masked_identifier: string | null;
      owner_user_id: string;
    } | null;
    ingestion_connections: { label: string } | null;
  };

  let memberSplits: Array<{ userId: string; shareBps: number }> = [];
  if (row.attribution_type === "split") {
    const { data: splitRows } = await supabase
      .from("transaction_member_attributions")
      .select("user_id, share_bps")
      .eq("transaction_id", id);
    memberSplits = ((splitRows ?? []) as unknown as Array<{
      user_id: string;
      share_bps: number;
    }>).map((s) => ({ userId: s.user_id, shareBps: s.share_bps }));
  }

  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspaces?.name ?? null,
    workspaceKind: row.workspaces?.kind ?? "personal",
    sourceName: row.financial_sources?.display_name ?? null,
    sourceProvider: row.financial_sources?.provider ?? null,
    sourceMaskedIdentifier: row.financial_sources?.masked_identifier ?? null,
    sourceOwnerUserId: row.financial_sources?.owner_user_id ?? null,
    performedByUserId: row.performed_by_user_id,
    recordCreatedByUserId: row.record_created_by_user_id,
    ingestionConnectionLabel: row.ingestion_connections?.label ?? null,
    attributionType: row.attribution_type,
    attributedUserId: row.attributed_user_id,
    allocationStatus: row.allocation_status,
    memberSplits,
  };
}

/** Household transactions the caller can see that still need an attribution. */
export async function getNeedsAttributionTransactions(): Promise<
  Array<{ id: string; occurredAt: string; amountRwf: number; direction: string; counterpartyName: string | null; workspaceName: string | null }>
> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, occurred_at, amount_rwf, direction, counterparty_name, workspaces(name)",
    )
    .eq("allocation_status", "needs_attribution")
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("getNeedsAttributionTransactions failed:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    occurred_at: string;
    amount_rwf: number;
    direction: string;
    counterparty_name: string | null;
    workspaces: { name: string } | null;
  }>).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    amountRwf: row.amount_rwf,
    direction: row.direction,
    counterpartyName: row.counterparty_name,
    workspaceName: row.workspaces?.name ?? null,
  }));
}

// ===========================================================================
// Duplicate review (Phase U PR3). space_duplicate_review /
// dismiss_possible_duplicate live in
// supabase/migrations/20260922000000_phase_u_duplicate_resolution.sql;
// merge_duplicate_transaction is Phase U PR1's. Ingestion (Phase U PR2)
// stamps transactions.dedupe_state = 'possible_duplicate' when a new
// transaction matches an existing fingerprint.
// ===========================================================================

export type DuplicateReviewTxn = {
  transactionId: string;
  dedupeState: "unique" | "possible_duplicate" | "confirmed_duplicate";
  counterparty: string | null;
  amountMinor: number;
  currency: string;
  direction: string;
  occurredAt: string;
  source: string;
  category: string | null;
  createdAt: string;
};

export type DuplicateReviewCluster = {
  fingerprint: string;
  transactions: DuplicateReviewTxn[];
};

/**
 * Possible-duplicate transactions in the caller's active Space, grouped
 * into clusters (one per fingerprint) for the review UI. Every cluster
 * has at least one `possible_duplicate` row; already-resolved (`unique`)
 * siblings are still returned so the reviewer sees the whole set. Empty
 * unless there's an active workspace and the caller can see the rows.
 */
export async function getSpaceDuplicateReview(): Promise<
  DuplicateReviewCluster[]
> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];

  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("space_duplicate_review", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    console.error("getSpaceDuplicateReview failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as Array<{
    fingerprint: string;
    transaction_id: string;
    dedupe_state: DuplicateReviewTxn["dedupeState"];
    counterparty: string | null;
    amount_minor: number;
    currency: string;
    direction: string;
    occurred_at: string;
    source: string;
    category: string | null;
    created_at: string;
  }>;

  const byFingerprint = new Map<string, DuplicateReviewCluster>();
  for (const r of rows) {
    let cluster = byFingerprint.get(r.fingerprint);
    if (!cluster) {
      cluster = { fingerprint: r.fingerprint, transactions: [] };
      byFingerprint.set(r.fingerprint, cluster);
    }
    cluster.transactions.push({
      transactionId: r.transaction_id,
      dedupeState: r.dedupe_state,
      counterparty: r.counterparty,
      amountMinor: r.amount_minor,
      currency: r.currency,
      direction: r.direction,
      occurredAt: r.occurred_at,
      source: r.source,
      category: r.category,
      createdAt: r.created_at,
    });
  }

  return Array.from(byFingerprint.values());
}

export type TransactionDuplicateContext = {
  dedupeState:
    | "unique"
    | "possible_duplicate"
    | "confirmed_duplicate"
    | "merged";
  /** Set when this transaction is itself `merged` - the canonical it was folded into. */
  mergedInto:
    | { id: string; occurredAt: string; counterparty: string | null }
    | null;
  /** Transactions that were merged INTO this one (kept for evidence, excluded from totals). */
  mergedDuplicates: Array<{
    id: string;
    occurredAt: string;
    counterparty: string | null;
    source: string;
  }>;
};

/**
 * Duplicate-resolution context for one transaction's detail page (Phase U
 * PR5): whether it is flagged / was merged away, and which other rows
 * were merged into it. Returns null only if the transaction itself can't
 * be read.
 */
export async function getTransactionDuplicateContext(
  id: string,
): Promise<TransactionDuplicateContext | null> {
  const supabase = await supabaseSession();

  const { data: self, error: selfError } = await supabase
    .from("transactions")
    .select("dedupe_state, merged_into_transaction_id")
    .eq("id", id)
    .maybeSingle();

  if (selfError || !self) {
    if (selfError) {
      console.error(
        "getTransactionDuplicateContext failed:",
        selfError.message,
      );
    }
    return null;
  }

  const row = self as unknown as {
    dedupe_state: TransactionDuplicateContext["dedupeState"];
    merged_into_transaction_id: string | null;
  };

  let mergedInto: TransactionDuplicateContext["mergedInto"] = null;
  if (row.merged_into_transaction_id) {
    const { data: canon } = await supabase
      .from("transactions")
      .select("id, occurred_at, counterparty_name")
      .eq("id", row.merged_into_transaction_id)
      .maybeSingle();
    if (canon) {
      const c = canon as unknown as {
        id: string;
        occurred_at: string;
        counterparty_name: string | null;
      };
      mergedInto = {
        id: c.id,
        occurredAt: c.occurred_at,
        counterparty: c.counterparty_name,
      };
    }
  }

  const { data: dups } = await supabase
    .from("transactions")
    .select("id, occurred_at, counterparty_name, source")
    .eq("merged_into_transaction_id", id)
    .order("occurred_at", { ascending: true });

  const mergedDuplicates = (
    (dups ?? []) as unknown as Array<{
      id: string;
      occurred_at: string;
      counterparty_name: string | null;
      source: string;
    }>
  ).map((d) => ({
    id: d.id,
    occurredAt: d.occurred_at,
    counterparty: d.counterparty_name,
    source: d.source,
  }));

  return { dedupeState: row.dedupe_state, mergedInto, mergedDuplicates };
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
    .eq("settlement_state", "settled")
    // Phase U: exclude rows merged into a canonical duplicate.
    .neq("dedupe_state", "merged");

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

// ===========================================================================
// Space category vocabulary (Phase T PR4). workspace_categories +
// upsert_workspace_category / set_workspace_category_archived live in
// supabase/migrations/20260920000000_phase_t_workspace_categories.sql.
// Free-text category names on transactions are unchanged; this is a
// per-Space list of preferred names, offered as suggestions.
// ===========================================================================

export type SpaceCategory = {
  key: string;
  label: string;
  parentKey: string | null;
  isArchived: boolean;
};

export type SpaceCategoryManagement = {
  workspaceId: string;
  canManage: boolean;
  categories: SpaceCategory[];
};

/**
 * The active Space's category vocabulary + whether the caller can edit
 * it. Returns null for a Personal Space (no shared vocabulary there).
 */
export async function getSpaceCategoryManagement(
  includeArchived = false,
): Promise<SpaceCategoryManagement | null> {
  const workspace = await getActiveWorkspace();
  if (!workspace || workspace.kind === "personal") return null;

  const supabase = await supabaseSession();
  let query = supabase
    .from("workspace_categories")
    .select("key, label, parent_key, is_archived")
    .eq("workspace_id", workspace.id)
    .order("label", { ascending: true });
  if (!includeArchived) query = query.eq("is_archived", false);

  const { data, error } = await query;
  if (error) {
    console.error("getSpaceCategoryManagement failed:", error.message);
    return null;
  }

  return {
    workspaceId: workspace.id,
    canManage: workspace.role === "owner" || workspace.role === "admin",
    categories: (
      (data ?? []) as unknown as Array<{
        key: string;
        label: string;
        parent_key: string | null;
        is_archived: boolean;
      }>
    ).map((r) => ({
      key: r.key,
      label: r.label,
      parentKey: r.parent_key,
      isArchived: r.is_archived,
    })),
  };
}

/**
 * Category-name suggestions for the correction form: the active Space's
 * (non-archived) preferred labels first, then any category name already
 * seen on a transaction. Deduplicated, order-preserving.
 */
export async function getCategorySuggestions(): Promise<string[]> {
  const [spaceMgmt, totals] = await Promise.all([
    getSpaceCategoryManagement(false),
    getCategoryTotals(),
  ]);

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === "Uncategorized" || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  for (const c of spaceMgmt?.categories ?? []) add(c.label);
  for (const t of totals) add(t.category);
  return out;
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
  financial_source_id: string | null;
  created_at: string;
};

const ACCOUNT_COLUMNS =
  "id, name, provider, currency, is_active, is_primary, archived_at, financial_source_id, created_at";

export async function getAccounts(): Promise<AccountRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("accounts")
    .select(ACCOUNT_COLUMNS)
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
  status: "active" | "paused" | "revoked";
  credential_prefix: string;
  last_used_at: string | null;
  paused_at: string | null;
  created_at: string;
  account_id: string;
  account_name: string;
  connector_installation_id: string | null;
  adapter_canary: ConnectorAdapterCanaryStatus | null;
};

export type CanonicalConnectionsReadCutoverStatus = {
  visibleLegacyCount: number;
  exactCanonicalCount: number;
  blockingCount: number;
  ready: boolean;
};

export async function getCanonicalConnectionsReadCutoverStatus(): Promise<
  CanonicalConnectionsReadCutoverStatus
> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc(
    "get_connector_canonical_read_cutover_status",
  );

  if (error || !data?.[0]) {
    if (error) {
      console.error(
        "getCanonicalConnectionsReadCutoverStatus failed:",
        error.message,
      );
    }
    return {
      visibleLegacyCount: 0,
      exactCanonicalCount: 0,
      blockingCount: 1,
      ready: false,
    };
  }

  const row = data[0] as {
    visible_legacy_count: number;
    exact_canonical_count: number;
    blocking_count: number;
    ready: boolean;
  };
  return {
    visibleLegacyCount: Number(row.visible_legacy_count),
    exactCanonicalCount: Number(row.exact_canonical_count),
    blockingCount: Number(row.blocking_count),
    ready: row.ready,
  };
}

export async function getIngestionConnections(): Promise<
  IngestionConnectionRow[]
> {
  const supabase = await supabaseSession();
  const [connectionResult, canaryResult] = await Promise.all([
    supabase
      .from("ingestion_connections")
      .select(
        // Two FKs link ingestion_connections to accounts (the plain account_id
        // one, and the composite ingestion_connections_account_same_workspace
        // one used only to guarantee same-workspace routing at the database
        // level) - the embed must name the single-column FK explicitly or
        // PostgREST cannot pick one automatically.
        "id, label, provider, status, credential_prefix, last_used_at, paused_at, created_at, account_id, connector_installation_id, accounts!ingestion_connections_account_id_fkey(name)",
      )
      .order("created_at", { ascending: true }),
    supabase.rpc("get_connector_adapter_canary_status"),
  ]);

  const { data, error } = connectionResult;

  if (error) {
    console.error("getIngestionConnections failed:", error.message);
    return [];
  }

  if (canaryResult.error) {
    console.error(
      "getConnectorAdapterCanaryStatus failed:",
      canaryResult.error.message,
    );
  }

  const canaries = new Map<string, ConnectorAdapterCanaryStatus>();
  for (const row of canaryResult.data ?? []) {
    const status = row as ConnectorAdapterCanaryStatus & {
      connector_installation_id: string;
    };
    canaries.set(status.connector_installation_id, status);
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
      paused_at: row.paused_at,
      created_at: row.created_at,
      account_id: row.account_id,
      account_name: account?.name ?? "Unknown account",
      connector_installation_id: row.connector_installation_id,
      adapter_canary: row.connector_installation_id
        ? canaries.get(row.connector_installation_id) ?? null
        : null,
    };
  });
}

/**
 * Stage D canonical settings projection. The Connections page executes this
 * only when the server flag requests cutover and the per-user database gate
 * proves every visible legacy row has an exact canonical representation.
 */
export async function getCanonicalConnectorInstallations(): Promise<
  CanonicalConnectorInstallation[]
> {
  const supabase = await supabaseSession();
  const [
    { data: userData, error: userError },
    { data: installationData, error: installationError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("connector_installations")
      .select(
        "id, owner_user_id, connector_key, display_name, status, auth_mode, last_attempt_at, last_success_at, last_error_code, revoked_at, created_at",
      )
      .order("created_at", { ascending: true }),
  ]);

  if (userError || !userData.user || installationError) {
    console.error(
      "getCanonicalConnectorInstallations failed:",
      userError?.message ?? installationError?.message ??
        "No authenticated user",
    );
    return [];
  }

  const installations = (installationData ?? []) as ConnectorInstallationRecord[];
  if (installations.length === 0) return [];
  const installationIds = installations.map((installation) => installation.id);

  const [sourceResult, credentialResult, canaryResult] = await Promise.all([
    supabase
      .from("financial_sources")
      .select(
        "id, connector_installation_id, provider, provider_key, source_type, display_name, masked_identifier, currency, status, created_at",
      )
      .in("connector_installation_id", installationIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("device_credentials")
      .select(
        "id, connector_installation_id, account_id, label, credential_prefix, status, last_used_at, expires_at, rotated_from_id, created_at, paused_at, revoked_at",
      )
      .in("connector_installation_id", installationIds)
      .order("created_at", { ascending: true }),
    supabase.rpc("get_connector_adapter_canary_status"),
  ]);

  if (sourceResult.error || credentialResult.error) {
    console.error(
      "getCanonicalConnectorInstallations relations failed:",
      sourceResult.error?.message ?? credentialResult.error?.message,
    );
    return [];
  }

  const sources = (sourceResult.data ?? []) as ConnectorSourceRecord[];
  const adapterCanaries = new Map<string, ConnectorAdapterCanaryStatus>();
  if (canaryResult.error) {
    console.error(
      "getCanonicalConnectorInstallations canaries failed:",
      canaryResult.error.message,
    );
  } else {
    for (const row of canaryResult.data ?? []) {
      const status = row as ConnectorAdapterCanaryStatus & {
        connector_installation_id: string;
      };
      adapterCanaries.set(status.connector_installation_id, status);
    }
  }
  const sourceIds = sources.map((source) => source.id);
  let accounts: ConnectorAccountRecord[] = [];

  if (sourceIds.length > 0) {
    const { data: accountData, error: accountError } = await supabase
      .from("accounts")
      .select(
        "id, financial_source_id, workspace_id, name, provider, currency, is_active, is_primary, archived_at, created_at",
      )
      .in("financial_source_id", sourceIds)
      .order("created_at", { ascending: true });

    if (accountError) {
      console.error(
        "getCanonicalConnectorInstallations accounts failed:",
        accountError.message,
      );
      return [];
    }
    accounts = (accountData ?? []) as ConnectorAccountRecord[];
  }

  return buildCanonicalConnectorReadModel({
    currentUserId: userData.user.id,
    installations,
    sources,
    accounts,
    credentials: (credentialResult.data ?? []) as DeviceCredentialRecord[],
    adapterCanaries,
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
    // Unmapped categories float to the top (they need the user's
    // action); within each group, largest spend first.
    .sort((a, b) => {
      const aUnmapped = a.allocationType === null ? 0 : 1;
      const bUnmapped = b.allocationType === null ? 0 : 1;
      if (aUnmapped !== bUnmapped) return aUnmapped - bUnmapped;
      return b.totalRwf - a.totalRwf;
    });
}

/**
 * Settled outgoing spend that carries no category at all - it can't be
 * mapped to an allocation until it's categorized (in the review queue).
 * Surfaced as a single summary row on the category-mappings screen so
 * both kinds of "not counted toward budget" are visible in one place.
 * Matches getBudgetActuals' filters (settled, out, not a merged dupe).
 */
export async function getUncategorizedOutflowSummary(): Promise<{
  count: number;
  totalRwf: number;
}> {
  const supabase = await supabaseSession();

  const { data, error } = await supabase
    .from("transactions")
    .select("principal_effect_rwf, fee_effect_rwf")
    .is("category", null)
    .eq("direction", "out")
    .eq("settlement_state", "settled")
    .neq("dedupe_state", "merged");

  if (error) {
    console.error("getUncategorizedOutflowSummary failed:", error.message);
    return { count: 0, totalRwf: 0 };
  }

  const rows = data ?? [];
  const totalRwf = rows.reduce(
    (sum, row) =>
      sum + Math.abs(Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf)),
    0,
  );
  return { count: rows.length, totalRwf };
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
      // Phase U: a merged duplicate is kept for evidence, never counted.
      .neq("dedupe_state", "merged")
      .gte("occurred_at", startUtc.toISOString())
      .lte("occurred_at", endUtc.toISOString()),
    supabase
      .from("transactions")
      .select("id, principal_effect_rwf, fee_effect_rwf")
      .eq("currency", budget.currency)
      .eq("direction", "in")
      .eq("settlement_state", "settled")
      .neq("dedupe_state", "merged")
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

  // Classification (split-governed / uncategorized / unmapped / mapped
  // allocation) is the canonical, single-implementation aggregation in
  // budget-math.ts - see aggregateOutflowsByAllocation's own comment for
  // why this must not be reimplemented here or anywhere else.
  const aggregation = aggregateOutflowsByAllocation(
    outRows.map((row) => ({
      transactionId: row.id,
      category: row.category,
      effectMinor: BigInt(Math.abs(Number(row.principal_effect_rwf) + Number(row.fee_effect_rwf))),
      occurredAtDateKey: kigaliDateKey(row.occurred_at),
    })),
    (splitsResult.data ?? []).map((row) => ({
      transactionId: row.transaction_id,
      allocationType: row.allocation_type as AllocationType,
      amountMinor: BigInt(row.amount_minor),
    })),
    (mappingsResult.data ?? []).map((row) => ({
      category: row.category,
      allocationType: row.allocation_type as AllocationType,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until,
    })),
  );
  const totalsByAllocation = new Map<AllocationType, number>(
    ALLOCATION_TYPES.map((type) => [type, Number(aggregation.totalsByAllocation[type])]),
  );
  const unmappedMinor = Number(aggregation.unmappedMinor);
  const unmappedCount = aggregation.unmappedCount;
  const uncategorizedMinor = Number(aggregation.uncategorizedMinor);
  const uncategorizedCount = aggregation.uncategorizedCount;

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

export type DashboardBudgetSummary = {
  budgetId: string;
  budgetName: string;
  totalTargetMinor: number;
  totalActualMinor: number;
  remainingMinor: number;
  percentUsed: number | null;
  /** The single worst allocation status across the budget, in the same
   *  severity order allocationStatus() itself defines - a dashboard
   *  summary card shows one status, not five, so this picks the one that
   *  most needs the user's attention rather than an arbitrary first
   *  allocation. */
  worstStatus: AllocationStatus;
  daysRemainingInPeriod: number | null;
  periodEnd: string;
  actionableAlertCount: number;
};

const STATUS_SEVERITY: Record<AllocationStatus, number> = {
  insufficient_data: 0,
  healthy: 1,
  watch: 2,
  at_risk: 3,
  exceeded: 4,
};

/**
 * A single-card summary of the caller's one active budget, for the Home
 * dashboard - reuses getBudgets/getBudgetById/getBudgetActuals verbatim
 * (the per-allocation math itself is never reimplemented here, only
 * summed/maxed across allocations) rather than a separate dashboard-only
 * computation. Returns null when there is no active budget - the Home
 * page simply omits the card rather than showing an empty-state box for
 * a legitimate, common state (see master prompt §8.2/§11.2).
 */
export async function getDashboardBudgetSummary(): Promise<DashboardBudgetSummary | null> {
  const budgets = await getBudgets();
  const active = budgets.find((b) => b.status === "active");
  if (!active) return null;

  const withAllocations = await getBudgetById(active.id);
  if (!withAllocations) return null;

  const actuals = await getBudgetActuals(withAllocations);

  const totalTargetMinor = actuals.allocations.reduce((sum, a) => sum + a.targetMinor, 0);
  const totalActualMinor = actuals.allocations.reduce((sum, a) => sum + a.actualMinor, 0);
  const worstStatus = actuals.allocations.reduce<AllocationStatus>(
    (worst, a) => (STATUS_SEVERITY[a.status] > STATUS_SEVERITY[worst] ? a.status : worst),
    "insufficient_data",
  );
  const actionableAlertCount = actuals.alerts.filter(
    (alert) => alert.severity === "warning" || alert.severity === "critical",
  ).length;

  const todayKey = kigaliDateKey(new Date().toISOString());
  const daysRemainingInPeriod = todayKey <= withAllocations.period_end
    ? Math.max(0, daysBetweenDateKeys(todayKey, withAllocations.period_end))
    : null;

  return {
    budgetId: withAllocations.id,
    budgetName: withAllocations.name,
    totalTargetMinor,
    totalActualMinor,
    remainingMinor: totalTargetMinor - totalActualMinor,
    percentUsed: totalTargetMinor > 0 ? (totalActualMinor / totalTargetMinor) * 100 : null,
    worstStatus,
    daysRemainingInPeriod,
    periodEnd: withAllocations.period_end,
    actionableAlertCount,
  };
}

// ===========================================================================
// Home dashboard "attention items" - concise, actionable states surfaced
// only from data this codebase already computes reliably elsewhere
// (review queue, learned-suggestion detection, budget alerts,
// ingestion-connection activity). See master prompt §8.3: no new
// detection logic is introduced here.
//
// Duplicate/suspicious-transaction detection and failed-import tracking
// are deliberately left out - there is no existing reliable signal for
// either (momo_messages, where a real 'failed' processing_status
// already exists, has no workspace scoping at all and grants
// `authenticated` zero access by design - service_role only - so
// exposing it here would need new schema/RLS work, not just a query).
// "Stale account data" DOES have a real, already-workspace-scoped,
// already-authenticated-readable signal - ingestion_connections.
// last_used_at (see getIngestionConnections) - so that one is
// implemented below, conservatively: only an ACTIVE connection that has
// NEVER received anything and was created more than a day ago (not "no
// activity in N days", which would false-positive on a genuinely
// low-transaction-volume user - master prompt §8.3's explicit "do not
// generate false urgency").
// ===========================================================================

export type AttentionItem = {
  id: string;
  label: string;
  count: number;
  href: string;
};

const STALE_CONNECTION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export async function getAttentionItems(): Promise<AttentionItem[]> {
  const [reviewQueueCount, learnedSuggestionCount, budgetSummary, connections] = await Promise.all([
    getReviewQueueCount(),
    getLearnedPolicySuggestionCount(),
    getDashboardBudgetSummary(),
    getIngestionConnections(),
  ]);

  const staleConnectionCount = connections.filter((connection) => {
    if (connection.status !== "active" || connection.last_used_at !== null) return false;
    return Date.now() - new Date(connection.created_at).getTime() > STALE_CONNECTION_GRACE_PERIOD_MS;
  }).length;

  const items: AttentionItem[] = [];

  if (reviewQueueCount > 0) {
    items.push({
      id: "review-queue",
      label: reviewQueueCount === 1 ? "Transaction needs review" : "Transactions need review",
      count: reviewQueueCount,
      href: "/transactions/review",
    });
  }

  if (learnedSuggestionCount > 0) {
    items.push({
      id: "learned-suggestions",
      label: learnedSuggestionCount === 1
        ? "Categorization rule suggested"
        : "Categorization rules suggested",
      count: learnedSuggestionCount,
      href: "/categories/rules/suggestions",
    });
  }

  if (budgetSummary && budgetSummary.actionableAlertCount > 0) {
    items.push({
      id: "budget-alerts",
      label: budgetSummary.actionableAlertCount === 1
        ? "Budget category needs attention"
        : "Budget categories need attention",
      count: budgetSummary.actionableAlertCount,
      href: `/budgets/${budgetSummary.budgetId}`,
    });
  }

  if (staleConnectionCount > 0) {
    items.push({
      id: "stale-connections",
      label: staleConnectionCount === 1
        ? "Connection hasn't sent any data yet"
        : "Connections haven't sent any data yet",
      count: staleConnectionCount,
      href: "/integrations/connections",
    });
  }

  return items;
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
// Shared goals (Phase T PR3): computed progress + participants.
// goal_progress() / set_goal_participants() / goal_participants live in
// supabase/migrations/20260919000000_phase_t_shared_goals.sql.
// ===========================================================================

export type GoalProgress = {
  targetMinor: number;
  currentMinor: number;
  pctComplete: number;
  targetDate: string | null;
  monthsToTarget: number | null;
  requiredMonthlyMinor: number;
  recentMonthlyRateMinor: number;
  projectedCompletionDate: string | null;
};

export async function getGoalProgress(goalId: string): Promise<GoalProgress | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("goal_progress", {
    p_goal_id: goalId,
  });
  if (error) {
    console.error("getGoalProgress failed:", error.message);
    return null;
  }
  const row = ((data ?? []) as unknown as Array<{
    target_minor: number;
    current_minor: number;
    pct_complete: number;
    target_date: string | null;
    months_to_target: number | null;
    required_monthly_minor: number;
    recent_monthly_rate_minor: number;
    projected_completion_date: string | null;
  }>)[0];
  if (!row) return null;
  return {
    targetMinor: row.target_minor,
    currentMinor: row.current_minor,
    pctComplete: Number(row.pct_complete),
    targetDate: row.target_date,
    monthsToTarget: row.months_to_target === null ? null : Number(row.months_to_target),
    requiredMonthlyMinor: row.required_monthly_minor,
    recentMonthlyRateMinor: row.recent_monthly_rate_minor,
    projectedCompletionDate: row.projected_completion_date,
  };
}

export type GoalCollaboration = {
  workspaceId: string;
  canManage: boolean;
  members: SpaceMember[];
  participantUserIds: string[];
};

/**
 * The participant list + the member roster + whether the caller can edit
 * it, for a goal in a shared (non-personal) Space. Returns null for a
 * personal-Space goal (no collaborators to show).
 */
export async function getGoalCollaboration(
  goalId: string,
): Promise<GoalCollaboration | null> {
  const workspace = await getActiveWorkspace();
  if (!workspace || workspace.kind === "personal") return null;

  const supabase = await supabaseSession();
  const [{ data: participants }, members] = await Promise.all([
    supabase
      .from("goal_participants")
      .select("user_id")
      .eq("goal_id", goalId),
    getSpaceMemberDirectory(workspace.id),
  ]);

  return {
    workspaceId: workspace.id,
    canManage: workspace.role === "owner" || workspace.role === "admin",
    members,
    participantUserIds: (
      (participants ?? []) as unknown as Array<{ user_id: string }>
    ).map((p) => p.user_id),
  };
}

// ===========================================================================
// Self-transfer detection -> web/lib/queries/transfers.ts
// ===========================================================================

export {
  getTransferCandidates,
  getTransferLinks,
  type LinkedTransferRow,
  type TransferCandidateDisplay,
} from "./queries/transfers";

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
  "id, name, description, category, subcategory, match_type, merchant_pattern, direction, amount_min_rwf, amount_max_rwf, time_start, time_end, priority, is_active, rule_source, confidence, usage_count, last_used_at, scope_type, scope_source_id";

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
  /** Phase U PR6: "space" (workspace-wide, default) or "source" (only scope_source_id). */
  scope_type: "space" | "source";
  scope_source_id: string | null;
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

/**
 * One account as a first-class object (master prompt section 16/24): the
 * account row plus its linked financial source (masked identifier + Space
 * visibility links), the ingestion connections bound to it, and the
 * categorization rules scoped specifically to it. RLS-scoped; read-only.
 * Returns null when the id is not an account the caller can see.
 */
export type AccountDetail = {
  account: AccountRow;
  source:
    | {
      id: string;
      displayName: string;
      maskedIdentifier: string | null;
      provider: string;
      visibilityMode: SourceVisibilityMode;
      status: "active" | "paused" | "archived";
      links: SourceSpaceLink[];
    }
    | null;
  connections: {
    id: string;
    label: string;
    provider: string;
    status: "active" | "paused" | "revoked";
    lastUsedAt: string | null;
    credentialPrefix: string;
  }[];
  rules: CategorizationPolicyRow[];
};

export async function getAccountDetail(
  accountId: string,
): Promise<AccountDetail | null> {
  const supabase = await supabaseSession();

  const { data: accountData, error: accountError } = await supabase
    .from("accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", accountId)
    .maybeSingle();

  if (accountError) {
    console.error("getAccountDetail account read failed:", accountError.message);
    return null;
  }
  if (!accountData) return null;
  const account = accountData as AccountRow;
  const sourceId = account.financial_source_id;

  const [sourceRes, connRes, policyRes] = await Promise.all([
    sourceId
      ? supabase
        .from("financial_sources")
        .select(
          "id, display_name, provider, masked_identifier, visibility_mode, status, source_space_links(workspace_id, visibility_mode, status, is_default_target, workspaces(name))",
        )
        .eq("id", sourceId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("ingestion_connections")
      .select(
        "id, label, provider, status, credential_prefix, last_used_at, account_id",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: true }),
    sourceId
      ? supabase
        .from("categorization_policies")
        .select(CATEGORIZATION_POLICY_COLUMNS)
        .eq("scope_type", "source")
        .eq("scope_source_id", sourceId)
        .order("priority", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  type RawLink = {
    workspace_id: string;
    visibility_mode: "share_transactions" | "share_account";
    status: "active" | "paused" | "revoked";
    is_default_target: boolean;
    workspaces: { name: string } | null;
  };
  const rawSource = sourceRes.data as
    | {
      id: string;
      display_name: string;
      provider: string;
      masked_identifier: string | null;
      visibility_mode: SourceVisibilityMode;
      status: "active" | "paused" | "archived";
      source_space_links: RawLink[] | null;
    }
    | null;

  return {
    account,
    source: rawSource
      ? {
        id: rawSource.id,
        displayName: rawSource.display_name,
        maskedIdentifier: rawSource.masked_identifier ?? null,
        provider: rawSource.provider,
        visibilityMode: rawSource.visibility_mode,
        status: rawSource.status,
        links: (rawSource.source_space_links ?? [])
          .filter((l) => l.status !== "revoked")
          .map((l) => ({
            workspaceId: l.workspace_id,
            workspaceName: l.workspaces?.name ?? null,
            visibilityMode: l.visibility_mode,
            status: l.status,
            isDefaultTarget: l.is_default_target,
          })),
      }
      : null,
    connections: ((connRes.data ?? []) as Array<{
      id: string;
      label: string;
      provider: string;
      status: "active" | "paused" | "revoked";
      credential_prefix: string;
      last_used_at: string | null;
    }>).map((c) => ({
      id: c.id,
      label: c.label,
      provider: c.provider,
      status: c.status,
      lastUsedAt: c.last_used_at,
      credentialPrefix: c.credential_prefix,
    })),
    rules: (policyRes.data ?? []) as CategorizationPolicyRow[],
  };
}

export async function getAccountTransactions(
  accountId: string,
  limit = 20,
): Promise<TransactionRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("account_id", accountId)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getAccountTransactions failed:", error.message);
    return [];
  }
  return data ?? [];
}

export type LearnedPolicySuggestionSample = {
  id: string;
  amount_rwf: number;
  occurred_at: string;
};

export type LearnedPolicySuggestion = {
  suggestionKey: string;
  counterpartyName: string;
  category: string;
  subcategory: string | null;
  occurrenceCount: number;
  lastOccurredAt: string;
  sample: LearnedPolicySuggestionSample[];
};

// Suggestions are computed on demand (see detect_learned_policy_suggestions
// in 20260831000000_phase_h_learned_suggestions.sql) - there's no
// background job in this app, so this always reflects the current state
// of transaction_category_history, not a stale cached list.
export async function getLearnedPolicySuggestions(): Promise<LearnedPolicySuggestion[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return [];
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("detect_learned_policy_suggestions", {
    p_workspace_id: workspaceId,
    p_min_occurrences: 3,
  });

  if (error || !data) {
    console.error("getLearnedPolicySuggestions failed:", error?.message);
    return [];
  }

  const sampleIds = data.flatMap((s: { sample_transaction_ids: string[] }) => s.sample_transaction_ids);
  const { data: sampleTransactions } = sampleIds.length > 0
    ? await supabase.from("transactions").select("id, amount_rwf, occurred_at").in("id", sampleIds)
    : { data: [] as LearnedPolicySuggestionSample[] };
  const byId = new Map((sampleTransactions ?? []).map((t) => [t.id, t]));

  return data.map((
    s: {
      suggestion_key: string;
      counterparty_name: string;
      category: string;
      subcategory: string | null;
      occurrence_count: number;
      last_occurred_at: string;
      sample_transaction_ids: string[];
    },
  ) => ({
    suggestionKey: s.suggestion_key,
    counterpartyName: s.counterparty_name,
    category: s.category,
    subcategory: s.subcategory,
    occurrenceCount: s.occurrence_count,
    lastOccurredAt: s.last_occurred_at,
    sample: s.sample_transaction_ids.map((id) => byId.get(id)).filter((t) =>
      t !== undefined
    ) as LearnedPolicySuggestionSample[],
  }));
}

export async function getLearnedPolicySuggestionCount(): Promise<number> {
  const suggestions = await getLearnedPolicySuggestions();
  return suggestions.length;
}

export type CategorizationInsights = {
  totalTransactions: number;
  statusCounts: Record<string, number>;
  activePolicyCount: number;
  /** Active policies that have never matched a transaction - worth a look. */
  unusedPolicies: { id: string; name: string | null; category: string }[];
  /**
   * Of transactions the engine auto/provisionally/suggestion-categorized
   * at ingestion, what fraction were later corrected by a human -
   * "accuracy" grounded in confirmed/corrected outcomes (spec §23.1),
   * not a raw self-reported percentage. Null when there's no automatic
   * decision to measure yet.
   */
  correctionRate: number | null;
};

// Follows the same full-column-scan-then-aggregate-in-JS pattern as
// getCategoryTotals() above - PostgREST has no server-side GROUP BY, and
// this repo's established convention for small aggregate views is a
// single bounded read plus client-side reduction rather than a new SQL
// function for every stats page.
export async function getCategorizationInsights(): Promise<CategorizationInsights> {
  const supabase = await supabaseSession();

  const [{ data: transactions, error: txnError }, { data: policies, error: policyError }, {
    data: historyRows,
    error: historyError,
  }] = await Promise.all([
    supabase.from("transactions").select("category_decision_status"),
    supabase.from("categorization_policies").select("id, name, category, is_active, usage_count").eq(
      "is_active",
      true,
    ),
    supabase.from("transaction_category_history").select("transaction_id, actor_type"),
  ]);

  if (txnError || policyError || historyError) {
    console.error(
      "getCategorizationInsights failed:",
      txnError?.message ?? policyError?.message ?? historyError?.message,
    );
    return {
      totalTransactions: 0,
      statusCounts: {},
      activePolicyCount: 0,
      unusedPolicies: [],
      correctionRate: null,
    };
  }

  const statusCounts: Record<string, number> = {};
  for (const t of transactions ?? []) {
    statusCounts[t.category_decision_status] = (statusCounts[t.category_decision_status] ?? 0) + 1;
  }

  const unusedPolicies = (policies ?? [])
    .filter((p) => p.usage_count === 0)
    .map((p) => ({ id: p.id, name: p.name, category: p.category }));

  const actorsByTransaction = new Map<string, Set<string>>();
  for (const row of historyRows ?? []) {
    const set = actorsByTransaction.get(row.transaction_id) ?? new Set<string>();
    set.add(row.actor_type);
    actorsByTransaction.set(row.transaction_id, set);
  }
  let autoDecidedCount = 0;
  let correctedCount = 0;
  for (const actors of actorsByTransaction.values()) {
    const hadAutoDecision = actors.has("ingestion_engine") || actors.has("system");
    if (hadAutoDecision) {
      autoDecidedCount += 1;
      if (actors.has("user")) correctedCount += 1;
    }
  }

  return {
    totalTransactions: (transactions ?? []).length,
    statusCounts,
    activePolicyCount: (policies ?? []).length,
    unusedPolicies,
    correctionRate: autoDecidedCount > 0 ? correctedCount / autoDecidedCount : null,
  };
}

export type BulkCategorizationRun = {
  bulkOperationId: string;
  policyId: string | null;
  policyName: string | null;
  appliedAt: string;
  rowCount: number;
  actorType: string;
};

export async function getBulkCategorizationRuns(): Promise<BulkCategorizationRun[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transaction_category_history")
    .select("bulk_operation_id, policy_id, actor_type, created_at, categorization_policies(name, category)")
    .not("bulk_operation_id", "is", null)
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.error("getBulkCategorizationRuns failed:", error?.message);
    return [];
  }

  const runs = new Map<string, BulkCategorizationRun>();
  for (const row of data) {
    const key = row.bulk_operation_id as string;
    const existing = runs.get(key);
    if (existing) {
      existing.rowCount += 1;
      continue;
    }
    const policyRelation = row.categorization_policies as unknown as
      | { name: string | null; category: string }
      | { name: string | null; category: string }[]
      | null;
    const policy = Array.isArray(policyRelation) ? policyRelation[0] : policyRelation;
    runs.set(key, {
      bulkOperationId: key,
      policyId: row.policy_id,
      policyName: policy?.name ?? policy?.category ?? null,
      appliedAt: row.created_at,
      rowCount: 1,
      actorType: row.actor_type,
    });
  }

  return Array.from(runs.values());
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
// Variable income -> web/lib/queries/variable-income.ts
// ===========================================================================

export {
  getVariableIncomeMonths,
  type VariableIncomeMonth,
  type VariableIncomeTransaction,
} from "./queries/variable-income";

// ===========================================================================
// Organization workspaces: creation, membership, invites. See
// supabase/migrations/20260827000000_organization_workspaces.sql.
// ===========================================================================

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type WorkspaceKind = "personal" | "organization" | "household";

export type WorkspaceSummary = {
  id: string;
  name: string;
  kind: WorkspaceKind;
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
      | { id: string; name: string; kind: WorkspaceKind }
      | null;
    if (!workspace) return [];
    return [
      { id: workspace.id, name: workspace.name, kind: workspace.kind, role: row.role },
    ] as WorkspaceSummary[];
  });
}

// ===========================================================================
// Financial sources and their per-Space sharing. See Phase Q/S migrations
// (20260910000000 financial_sources / source_space_links, 20260914000000
// the sharing RPCs). "Source" is the user-facing name for a person-owned
// financial_sources row; a household member decides, per source, what each
// Space they belong to may see of it.
// ===========================================================================

export type SourceVisibilityMode =
  | "personal_only"
  | "share_transactions"
  | "share_account";

export type SourceSpaceLink = {
  workspaceId: string;
  workspaceName: string | null;
  visibilityMode: "share_transactions" | "share_account";
  status: "active" | "paused" | "revoked";
  isDefaultTarget: boolean;
};

export type FinancialSourceRow = {
  id: string;
  displayName: string;
  provider: string;
  sourceType: string;
  currency: string;
  maskedIdentifier: string | null;
  visibilityMode: SourceVisibilityMode;
  status: "active" | "paused" | "archived";
  links: SourceSpaceLink[];
};

/**
 * The financial sources the caller *owns* (not ones merely shared with
 * them), each with its collaborative Space allocations. financial_sources'
 * RLS also returns sources shared into the caller's Spaces, so this
 * filters to owner_user_id = the caller explicitly.
 */
export async function getMyFinancialSources(): Promise<FinancialSourceRow[]> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("financial_sources")
    .select(
      "id, display_name, provider, source_type, currency, masked_identifier, visibility_mode, status, source_space_links(workspace_id, visibility_mode, status, is_default_target, workspaces(name))",
    )
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getMyFinancialSources failed:", error.message);
    return [];
  }

  type RawLink = {
    workspace_id: string;
    visibility_mode: "share_transactions" | "share_account";
    status: "active" | "paused" | "revoked";
    is_default_target: boolean;
    workspaces: { name: string } | null;
  };
  type RawSource = {
    id: string;
    display_name: string;
    provider: string;
    source_type: string;
    currency: string;
    masked_identifier: string | null;
    visibility_mode: SourceVisibilityMode;
    status: "active" | "paused" | "archived";
    source_space_links: RawLink[] | null;
  };

  return ((data ?? []) as unknown as RawSource[]).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    provider: row.provider,
    sourceType: row.source_type,
    currency: row.currency,
    maskedIdentifier: row.masked_identifier ?? null,
    visibilityMode: row.visibility_mode,
    status: row.status,
    links: (row.source_space_links ?? [])
      .filter((link) => link.status !== "revoked")
      .map((link) => ({
        workspaceId: link.workspace_id,
        workspaceName: link.workspaces?.name ?? null,
        visibilityMode: link.visibility_mode,
        status: link.status,
        isDefaultTarget: link.is_default_target,
      })),
  }));
}

/**
 * Per-source inbound-email addresses the caller owns (ADR 0018 Slice B).
 * Returns { [financialSourceId]: "u+<token>@<domain>" } for sources that
 * currently have a token; sources without one are absent. RLS keeps this
 * to the caller's own sources.
 */
export async function getSourceIngestEmails(): Promise<Record<string, string>> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data, error } = await supabase
    .from("financial_sources")
    .select("id, ingest_email_token")
    .eq("owner_user_id", user.id)
    .not("ingest_email_token", "is", null);

  if (error) {
    console.error("getSourceIngestEmails failed:", error.message);
    return {};
  }

  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim() || "in.oneledger.me";
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; ingest_email_token: string }[]) {
    out[row.id] = `u+${row.ingest_email_token}@${domain}`;
  }
  return out;
}

/**
 * Households the caller can share a source into - every active household
 * membership above 'viewer' (allocate_source_to_space requires 'member').
 */
export async function getShareableHouseholds(): Promise<WorkspaceSummary[]> {
  const workspaces = await getUserWorkspaces();
  return workspaces.filter(
    (workspace) => workspace.kind === "household" && workspace.role !== "viewer",
  );
}

/** The active workspace's own id/name/kind/the caller's role in it - for the workspace settings page and the switcher's current-selection label. */
export async function getActiveWorkspace(): Promise<WorkspaceSummary | null> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return null;

  const workspaces = await getUserWorkspaces();
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

// ===========================================================================
// Per-member notification preferences for the active Space. See Phase Q
// (space_member_notification_prefs) and Phase T PR1
// (20260917000000_phase_t_notification_resolution.sql: notification_event_
// catalog / should_notify). Security-notable events are always on.
// ===========================================================================

export type NotificationEventSetting = {
  eventKey: string;
  label: string;
  securityNotable: boolean;
  inApp: boolean;
  email: boolean;
};

export type NotificationSettings = {
  workspaceId: string;
  workspaceName: string;
  events: NotificationEventSetting[];
};

// ===========================================================================
// Notifications (Phase V PR1). notifications table + enqueue_notification /
// mark_notification_read / mark_all_notifications_read /
// unread_notification_count live in
// supabase/migrations/20261001000000_phase_v_notifications.sql.
// ===========================================================================

export type NotificationRow = {
  id: string;
  workspaceId: string;
  eventKey: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};

/** The caller's unread in-app notification count, for the header bell. 0 on any error. */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("unread_notification_count");
  if (error) {
    console.error("getUnreadNotificationCount failed:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

/** The caller's in-app notifications, newest first (RLS scopes to own rows). */
export async function getNotifications(limit = 50): Promise<NotificationRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, workspace_id, event_key, title, body, resource_type, resource_id, read_at, created_at",
    )
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getNotifications failed:", error.message);
    return [];
  }

  return (
    (data ?? []) as unknown as Array<{
      id: string;
      workspace_id: string;
      event_key: string;
      title: string;
      body: string | null;
      resource_type: string | null;
      resource_id: string | null;
      read_at: string | null;
      created_at: string;
    }>
  ).map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    eventKey: r.event_key,
    title: r.title,
    body: r.body,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

export async function getNotificationSettings(): Promise<NotificationSettings | null> {
  const workspace = await getActiveWorkspace();
  if (!workspace || workspace.kind === "personal") return null;

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: catalog }, { data: prefs }] = await Promise.all([
    supabase.rpc("notification_event_catalog"),
    supabase
      .from("space_member_notification_prefs")
      .select("event_key, channel, enabled")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id),
  ]);

  const prefMap = new Map<string, boolean>();
  for (const p of (prefs ?? []) as unknown as Array<{
    event_key: string;
    channel: string;
    enabled: boolean;
  }>) {
    prefMap.set(`${p.event_key}:${p.channel}`, p.enabled);
  }

  const rows = (catalog ?? []) as unknown as Array<{
    event_key: string;
    label: string;
    default_in_app: boolean;
    default_email: boolean;
    security_notable: boolean;
  }>;

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    events: rows.map((row) => {
      const resolve = (channel: "in_app" | "email", dflt: boolean) =>
        row.security_notable
          ? true
          : (prefMap.get(`${row.event_key}:${channel}`) ?? dflt);
      return {
        eventKey: row.event_key,
        label: row.label,
        securityNotable: row.security_notable,
        inApp: resolve("in_app", row.default_in_app),
        email: resolve("email", row.default_email),
      };
    }),
  };
}

// ===========================================================================
// Household dashboard: spending this month, split by member. Neutral
// framing (master prompt §22) - a breakdown, never a "who spent more"
// comparison. Only computed when the active Space is a household.
// ===========================================================================

export type HouseholdSpendBucket = {
  key: string; // "shared" | "unassigned" | a user id
  label: string;
  amountMinor: number;
  percent: number;
};

export type HouseholdSpendBreakdown = {
  workspaceName: string;
  monthLabel: string;
  totalMinor: number;
  buckets: HouseholdSpendBucket[];
};

export async function getHouseholdSpendingBreakdown(): Promise<HouseholdSpendBreakdown | null> {
  const workspace = await getActiveWorkspace();
  if (!workspace || workspace.kind !== "household") return null;

  const monthKey = kigaliDateKey(new Date().toISOString()).slice(0, 7); // YYYY-MM
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  const monthStartKey = `${monthKey}-01`;
  const nextMonthStartKey =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const startUtc = kigaliDayBoundsUtc(monthStartKey).startUtc.toISOString();
  const endUtc = kigaliDayBoundsUtc(nextMonthStartKey).startUtc.toISOString();
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, attribution_type, attributed_user_id, principal_effect_rwf, fee_effect_rwf",
    )
    .eq("direction", "out")
    .eq("settlement_state", "settled")
    // Phase U: a merged duplicate is kept for evidence, never counted.
    .neq("dedupe_state", "merged")
    .gte("occurred_at", startUtc)
    .lt("occurred_at", endUtc);

  if (error) {
    console.error("getHouseholdSpendingBreakdown failed:", error.message);
    return null;
  }

  type Row = {
    id: string;
    attribution_type: TransactionAttributionType | null;
    attributed_user_id: string | null;
    principal_effect_rwf: number | null;
    fee_effect_rwf: number | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const effectOf = (r: Row) =>
    Math.abs(Number(r.principal_effect_rwf) + Number(r.fee_effect_rwf));

  const totals = new Map<string, number>();
  const add = (key: string, minor: number) =>
    totals.set(key, (totals.get(key) ?? 0) + minor);

  const splitIds: string[] = [];
  for (const r of rows) {
    if (r.attribution_type === "shared") add("shared", effectOf(r));
    else if (r.attribution_type === "member" && r.attributed_user_id)
      add(r.attributed_user_id, effectOf(r));
    else if (r.attribution_type === "split") splitIds.push(r.id);
    else add("unassigned", effectOf(r));
  }

  if (splitIds.length > 0) {
    const { data: splitRows } = await supabase
      .from("transaction_member_attributions")
      .select("transaction_id, user_id, share_bps")
      .in("transaction_id", splitIds);
    const byTxn = new Map<string, Array<{ userId: string; bps: number }>>();
    for (const s of (splitRows ?? []) as unknown as Array<{
      transaction_id: string;
      user_id: string;
      share_bps: number;
    }>) {
      const list = byTxn.get(s.transaction_id) ?? [];
      list.push({ userId: s.user_id, bps: s.share_bps });
      byTxn.set(s.transaction_id, list);
    }
    for (const id of splitIds) {
      const r = rows.find((x) => x.id === id)!;
      const parts = byTxn.get(id);
      const effect = effectOf(r);
      if (!parts || parts.length === 0) {
        add("unassigned", effect);
        continue;
      }
      for (const p of parts) add(p.userId, Math.round((effect * p.bps) / 10000));
    }
  }

  const members = await getSpaceMemberDirectory(workspace.id);
  const nameOf = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ?? "A member";

  const totalMinor = Array.from(totals.values()).reduce((a, b) => a + b, 0);

  const buckets: HouseholdSpendBucket[] = Array.from(totals.entries())
    .filter(([, minor]) => minor > 0)
    .map(([key, amountMinor]) => ({
      key,
      label:
        key === "shared"
          ? "Shared"
          : key === "unassigned"
            ? "Unassigned"
            : nameOf(key),
      amountMinor,
      percent: totalMinor > 0 ? Math.round((amountMinor / totalMinor) * 100) : 0,
    }))
    .sort((a, b) => {
      if (a.key === "shared") return -1;
      if (b.key === "shared") return 1;
      if (a.key === "unassigned") return 1;
      if (b.key === "unassigned") return -1;
      return b.amountMinor - a.amountMinor;
    });

  return {
    workspaceName: workspace.name,
    monthLabel,
    totalMinor,
    buckets,
  };
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
  /** expires_at is in the past (server-evaluated at query time). */
  expired: boolean;
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

  const now = Date.now();
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() < now,
  }));
}

// ===========================================================================
// Phase E: Scheduled Financial Reporting - preferences and report_runs.
// Session-scoped (RLS-enforced), matching every other function in this
// file - report generation itself is service-role (web/lib/
// report-generation.ts) and deliberately does not share these functions.
// ===========================================================================

export type ReportRunStatus =
  | "scheduled"
  | "generating"
  | "generated"
  | "generation_failed"
  | "delivery_pending"
  | "delivering"
  | "delivered"
  | "delivery_failed";

import type { AiCommentaryPayload, ReportPayload } from "./report-types";
export type { AiCommentaryPayload, ReportPayload };

export type ReportRunSummary = {
  id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  timezone: string;
  status: ReportRunStatus;
  generated_at: string | null;
  created_at: string;
};

const REPORT_RUN_SUMMARY_COLUMNS =
  "id, report_type, period_start, period_end, timezone, status, generated_at, created_at";

/**
 * Most recent reports first, for the caller's own user_id (RLS:
 * report_runs_select_own). By default NOT filtered by workspace_id - a
 * report belongs to its recipient, not broadly to every workspace member,
 * and a user can have report_preferences (and therefore report_runs) in
 * more than one workspace they belong to. Pass `workspaceId` when the
 * caller wants only that workspace's reports (e.g. the Daily Reports
 * settings page, which is itself scoped to one workspace's preferences -
 * mixing another workspace's reports in there would misleadingly suggest
 * they belong to the one being configured).
 */
export async function getReportRuns(
  limit = 30,
  workspaceId?: string,
): Promise<ReportRunSummary[]> {
  const supabase = await supabaseSession();
  let query = supabase
    .from("report_runs")
    .select(REPORT_RUN_SUMMARY_COLUMNS)
    .order("period_start", { ascending: false })
    .limit(limit);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("getReportRuns failed:", error.message);
    return [];
  }

  return data ?? [];
}

export type ReportRunDetail = ReportRunSummary & {
  report_payload: ReportPayload | null;
  ai_payload: AiCommentaryPayload | null;
  error_message: string | null;
};

export async function getReportRunById(id: string): Promise<ReportRunDetail | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("report_runs")
    .select(`${REPORT_RUN_SUMMARY_COLUMNS}, report_payload, ai_payload, error_message`)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getReportRunById failed:", error.message);
    return null;
  }

  return data as unknown as ReportRunDetail | null;
}

export type ReportPreferencesRow = {
  id: string;
  timezone: string;
  daily_report_enabled: boolean;
  generation_time: string;
  delivery_time: string;
  email_enabled: boolean;
  delivery_email: string | null;
  include_ai_analysis: boolean;
  // Per-user alert thresholds (migration 20261125000000). alert_low_balance_rwf
  // null = low-balance check disabled; the rest are NOT NULL in the DB.
  alert_large_transaction_rwf: number;
  alert_high_daily_spend_rwf: number;
  alert_elevated_fees_rwf: number;
  alert_low_balance_rwf: number | null;
  alert_sustained_negative_cashflow_days: number;
  alert_uncategorized_percent: number;
};

// Must stay a single string literal (not a concatenation) so supabase-js
// can infer the row shape from it.
const REPORT_PREFERENCES_COLUMNS =
  "id, timezone, daily_report_enabled, generation_time, delivery_time, email_enabled, delivery_email, include_ai_analysis, alert_large_transaction_rwf, alert_high_daily_spend_rwf, alert_elevated_fees_rwf, alert_low_balance_rwf, alert_sustained_negative_cashflow_days, alert_uncategorized_percent";

/** The caller's own report preferences in their active workspace, or null if they've never set any (defaults are then whatever the settings form itself shows, never silently assumed enabled - see report_preferences' own migration comment on opt-in defaults). */
export async function getReportPreferences(): Promise<ReportPreferencesRow | null> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getActiveWorkspaceId();

  if (!user || !workspaceId) return null;

  const { data, error } = await supabase
    .from("report_preferences")
    .select(REPORT_PREFERENCES_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("getReportPreferences failed:", error.message);
    return null;
  }

  return data;
}

// ===========================================================================
// Phase L: application-shell UI preferences (navigation order, balance/
// dashboard display-privacy, one-time notices). Session-scoped (RLS-
// enforced) like everything else in this file - see
// supabase/migrations/20260904000000_phase_l_ui_preferences.sql.
// ===========================================================================

export type UiPreferencesRow = {
  hideBalance: boolean;
  privacyMode: boolean;
};

// nav_order is no longer read - the primary nav is a fixed journey now
// (lib/navigation.ts). The column stays in the table until a deliberate
// drop migration.
const UI_PREFERENCES_COLUMNS = "hide_balance, privacy_mode";

/**
 * The caller's own shell/navigation/privacy preferences in their active
 * workspace, or a safe all-default value if they've never set any, the
 * lookup fails, or there is no session - callers should never need to
 * null-check this the way getReportPreferences' callers do, since an
 * application shell must always have *some* nav order/privacy state to
 * render with on first paint (see master prompt §6.4/§11.1 on avoiding a
 * flash of sensitive content and blocking navigation on preference load).
 */
export async function getUiPreferences(): Promise<UiPreferencesRow> {
  const fallback: UiPreferencesRow = {
    hideBalance: false,
    privacyMode: false,
  };

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getActiveWorkspaceId();

  if (!user || !workspaceId) return fallback;

  const { data, error } = await supabase
    .from("ui_preferences")
    .select(UI_PREFERENCES_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("getUiPreferences failed:", error.message);
    return fallback;
  }

  if (!data) return fallback;

  return {
    hideBalance: data.hide_balance,
    privacyMode: data.privacy_mode,
  };
}

// ===========================================================================
// Onboarding checklist (onboarding work PR4). Step completion is derived
// live here from existing signals; only the "dismissed" flag is stored
// (ui_preferences.onboarding_dismissed,
// 20261006000000_onboarding_checklist_dismissed.sql). Pure step logic +
// types live in ./onboarding.ts (Deno-tested).
// ===========================================================================

import { deriveOnboardingState, type OnboardingState } from "./onboarding";
import type { ProfileOnboardingStep } from "./profile-onboarding";

export type ProfileOnboarding = {
  firstName: string;
  lastName: string;
  countryCode: string;
  preferredCurrency: string;
  timezone: string;
  locale: string;
  step: ProfileOnboardingStep;
};

export async function getProfileOnboarding(): Promise<ProfileOnboarding | null> {
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, country_code, preferred_currency, timezone, locale, onboarding_step")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("getProfileOnboarding failed:", error.message);
    return null;
  }

  return {
    firstName: data.first_name ?? "",
    lastName: data.last_name ?? "",
    countryCode: data.country_code ?? "RW",
    preferredCurrency: data.preferred_currency,
    timezone: data.timezone,
    locale: data.locale,
    step: data.onboarding_step as ProfileOnboardingStep,
  };
}

export type OnboardingSnapshot = OnboardingState & {
  /** Feature flag + workspace allowlist both passed. */
  enabled: boolean;
  /** The user has dismissed the reminder in this workspace. */
  dismissed: boolean;
  /** Show the dashboard nudge: enabled, not dismissed, not complete. */
  showNudge: boolean;
};

function onboardingChecklistEnabled(workspaceId: string | null): boolean {
  // Same convention as the Pay/Reports flags: on unless the exact string
  // "false", plus an optional comma-separated workspace allowlist.
  if (process.env.ONBOARDING_CHECKLIST_ENABLED === "false") return false;
  const raw = process.env.ONBOARDING_CHECKLIST_WORKSPACE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(
    workspaceId,
  );
}

/**
 * The onboarding checklist for the caller's active workspace: which of
 * the four setup steps are done, what to do next, and whether to show the
 * dashboard nudge. Safe to call on every dashboard render - three small
 * indexed reads, all RLS-scoped. Returns a disabled, all-false snapshot
 * when the flag is off so callers can treat it uniformly.
 */
export async function getOnboardingState(): Promise<OnboardingSnapshot> {
  const workspace = await getActiveWorkspace();
  const workspaceId = workspace?.id ?? null;
  const enabled = onboardingChecklistEnabled(workspaceId);

  const base = deriveOnboardingState({
    emailConfirmed: false,
    accountCount: 0,
    activeConnectionCount: 0,
    liveConnectionCount: 0,
  });

  // An organization Space shares one ledger; a plain member/viewer has no
  // account or device of their own to set up, so the checklist doesn't
  // apply to them. Household members DO each wire their own device, and
  // personal workspaces / org owners+admins get the full checklist.
  // (Rule to confirm with the maintainer - see the PR6 design note.)
  const orgNonManager = workspace?.kind === "organization" &&
    (workspace.role === "member" || workspace.role === "viewer");

  if (!enabled || !workspaceId || orgNonManager) {
    return { ...base, enabled: false, dismissed: false, showNudge: false };
  }

  const supabase = await supabaseSession();
  const [{ data: { user } }, accountsRes, connectionsRes, prefsRes] =
    await Promise.all([
      supabase.auth.getUser(),
      supabase.from("accounts").select("id, is_active, archived_at"),
      supabase.from("ingestion_connections").select("status, last_used_at"),
      supabase
        .from("ui_preferences")
        .select("onboarding_dismissed")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

  const accounts = accountsRes.data ?? [];
  const connections = connectionsRes.data ?? [];

  const state = deriveOnboardingState({
    emailConfirmed: Boolean(user?.email_confirmed_at),
    accountCount: accounts.filter((a) => a.is_active && !a.archived_at).length,
    activeConnectionCount:
      connections.filter((c) => c.status === "active").length,
    liveConnectionCount: connections.filter((c) => c.last_used_at != null).length,
  });

  const dismissed = Boolean(prefsRes.data?.onboarding_dismissed);

  return {
    ...state,
    enabled: true,
    dismissed,
    showNudge: !dismissed && !state.complete,
  };
}
