import { supabase } from "@/api/supabase";

import { getDuplicateContext, type DuplicateContext } from "./duplicates";
import { listWorkspaceTags } from "./tags";
import type {
  AllocationStatus,
  CategoryHistoryEntry,
  Member,
  TransactionContext,
  WorkspaceKind,
} from "./detailDisplay";

// Read-only extras for the transaction detail screen, ported from
// web/lib/queries.ts (getTransactionSpaceContext, getCategoryHistory),
// web/lib/transaction-tags.ts and the space_member_directory function. Plain
// reads under the signed-in user's RLS, like every other app query. Each is
// loaded on its own and may fail on its own (see loadDetailExtras): a missing
// block never takes the whole screen down.

function client() {
  if (!supabase) throw new Error("not connected");
  return supabase;
}

type ContextRow = {
  workspace_id: string;
  performed_by_user_id: string | null;
  record_created_by_user_id: string | null;
  allocation_status: AllocationStatus;
  category_source: string | null;
  workspaces: { name: string; kind: WorkspaceKind } | { name: string; kind: WorkspaceKind }[] | null;
  financial_sources:
    | { display_name: string; provider: string; masked_identifier: string | null; owner_user_id: string }
    | { display_name: string; provider: string; masked_identifier: string | null; owner_user_id: string }[]
    | null;
  ingestion_connections: { label: string } | { label: string }[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function getTransactionContext(id: string): Promise<TransactionContext | null> {
  const { data, error } = await client()
    .from("transactions")
    .select(
      "workspace_id, performed_by_user_id, record_created_by_user_id, allocation_status, category_source, workspaces(name, kind), financial_sources(display_name, provider, masked_identifier, owner_user_id), ingestion_connections(label)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as ContextRow;
  const workspace = one(row.workspaces);
  const source = one(row.financial_sources);
  return {
    workspaceId: row.workspace_id,
    workspaceName: workspace?.name ?? null,
    workspaceKind: workspace?.kind ?? null,
    sourceName: source?.display_name ?? null,
    sourceProvider: source?.provider ?? null,
    sourceMaskedIdentifier: source?.masked_identifier ?? null,
    sourceOwnerUserId: source?.owner_user_id ?? null,
    performedByUserId: row.performed_by_user_id,
    recordCreatedByUserId: row.record_created_by_user_id,
    ingestionConnectionLabel: one(row.ingestion_connections)?.label ?? null,
    allocationStatus: row.allocation_status,
    categorySource: row.category_source,
  };
}

export async function getCategoryHistory(id: string): Promise<CategoryHistoryEntry[]> {
  const { data, error } = await client()
    .from("transaction_category_history")
    .select("id, previous_category, new_category, decision_reason, actor_type, created_at")
    .eq("transaction_id", id)
    .order("created_at", { ascending: false });
  if (error) throw new Error("history unavailable");
  return (data ?? []) as CategoryHistoryEntry[];
}

export async function getTransactionTags(id: string): Promise<string[]> {
  const { data, error } = await client()
    .from("transaction_tags")
    .select("tag")
    .eq("transaction_id", id)
    .order("tag", { ascending: true });
  if (error) throw new Error("tags unavailable");
  return (data ?? []).map((r) => r.tag as string);
}

/** Active members of a Space with display names; the database checks the caller is a member. */
export async function getSpaceMembers(workspaceId: string): Promise<Member[]> {
  const { data, error } = await client().rpc("space_member_directory", { p_workspace_id: workspaceId });
  if (error) throw new Error("members unavailable");
  return ((data ?? []) as { user_id: string; display_name: string | null }[]).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
  }));
}

export async function getSelfUserId(): Promise<string | null> {
  const { data } = await client().auth.getUser();
  return data.user?.id ?? null;
}

export type DetailExtras = {
  context: TransactionContext | null;
  history: CategoryHistoryEntry[];
  tags: string[];
  /** Tags used elsewhere in the Space, to suggest (empty when unknown). */
  tagSuggestions: string[];
  duplicates: DuplicateContext | null;
  members: Member[];
  selfUserId: string | null;
};

const settled = async <T,>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

/**
 * Everything the detail screen shows beyond the transaction row. Every part
 * falls back independently (no context, no history, no tags...), so a single
 * failed read removes only its own block.
 */
export async function loadDetailExtras(id: string): Promise<DetailExtras> {
  const context = await settled(() => getTransactionContext(id), null);
  const household = context?.workspaceKind === "household";
  const [history, tags, tagSuggestions, duplicates, members, selfUserId] = await Promise.all([
    settled(() => getCategoryHistory(id), []),
    settled(() => getTransactionTags(id), []),
    context ? settled(() => listWorkspaceTags(context.workspaceId), []) : Promise.resolve([]),
    settled(() => getDuplicateContext(id), null),
    household && context ? settled(() => getSpaceMembers(context.workspaceId), []) : Promise.resolve([]),
    household ? settled(() => getSelfUserId(), null) : Promise.resolve(null),
  ]);
  return { context, history, tags, tagSuggestions, duplicates, members, selfUserId };
}
