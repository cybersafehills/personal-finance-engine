import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Read projections for the developer API. Every function takes the
// service-role client and an explicit workspaceId (resolved from the API
// key) and pins it on every query - the "service-role code resolves
// explicit tenant scope" invariant. No session, no RLS reliance. Output is
// a stable, redacted JSON shape: internal ids that aren't useful to a
// consumer are dropped, and nothing carries credentials or storage paths.

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- compound (timestamp, id) cursor -------------------------------------

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(
  raw: string | null,
): { ts: string; id: string } | null {
  if (!raw) return null;
  try {
    const [ts, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!ts || !id) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

/** Apply a "(col, id) < (cursor.ts, cursor.id)" keyset filter, descending.
 *  The timestamp is normalised to a `...Z` ISO string so the PostgREST
 *  `.or()` filter value is unambiguous. */
function afterKeyset(q: any, col: string, cursor: { ts: string; id: string }) {
  const ts = Number.isNaN(Date.parse(cursor.ts))
    ? cursor.ts
    : new Date(cursor.ts).toISOString();
  return q.or(
    `${col}.lt.${ts},and(${col}.eq.${ts},id.lt.${cursor.id})`,
  );
}

// --- transactions ------------------------------------------------------

export type ApiTransactionFilters = {
  from?: string;
  to?: string;
  accountId?: string;
  direction?: "in" | "out" | "neutral";
  category?: string;
};

function txnRow(t: any) {
  return {
    id: t.id,
    occurred_at: t.occurred_at,
    direction: t.direction,
    amount_minor: t.amount_rwf,
    currency: t.currency,
    description: t.counterparty_name ?? null,
    reference: t.counterparty_reference ?? null,
    external_id: t.external_transaction_id ?? null,
    category: t.category ?? null,
    account_id: t.account_id ?? null,
    source: t.source ?? null,
  };
}

export async function listTransactions(
  admin: SupabaseClient,
  workspaceId: string,
  filters: ApiTransactionFilters,
  limit: number,
  cursorRaw: string | null,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  let q = admin
    .from("transactions")
    .select(
      "id, occurred_at, direction, amount_rwf, currency, counterparty_name, counterparty_reference, external_transaction_id, category, account_id, source",
    )
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (filters.from) q = q.gte("occurred_at", filters.from);
  if (filters.to) q = q.lte("occurred_at", filters.to);
  if (filters.accountId) q = q.eq("account_id", filters.accountId);
  if (filters.direction) q = q.eq("direction", filters.direction);
  if (filters.category) q = q.eq("category", filters.category);
  const cursor = decodeCursor(cursorRaw);
  if (cursor) q = afterKeyset(q, "occurred_at", cursor);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(txnRow),
    nextCursor: hasMore && last
      ? encodeCursor(last.occurred_at, last.id)
      : null,
  };
}

export async function getTransaction(
  admin: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<unknown | null> {
  const { data } = await admin
    .from("transactions")
    .select(
      "id, occurred_at, direction, amount_rwf, currency, counterparty_name, counterparty_reference, external_transaction_id, category, account_id, source",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return data ? txnRow(data) : null;
}

// --- accounts / categories ------------------------------------------------

export async function listAccounts(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<unknown[]> {
  const { data, error } = await admin
    .from("accounts")
    .select("id, name, provider, currency, is_active, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    provider: a.provider,
    currency: a.currency,
    is_active: a.is_active,
    created_at: a.created_at,
  }));
}

export async function listCategories(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<unknown[]> {
  const { data, error } = await admin
    .from("workspace_categories")
    .select("key, label, parent_key, is_archived")
    .eq("workspace_id", workspaceId)
    .order("label", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c: any) => ({
    key: c.key,
    label: c.label,
    parent_key: c.parent_key ?? null,
    is_archived: c.is_archived,
  }));
}

// --- exports -----------------------------------------------------------

function exportRow(j: any) {
  return {
    id: j.id,
    format: j.format,
    status: j.status,
    row_count: j.row_count ?? null,
    requested_at: j.requested_at,
    completed_at: j.completed_at ?? null,
    // download_url is filled in by the [id] route (a short-lived signed URL);
    // never expose storage_path.
    downloadable: j.status === "completed" && !!j.storage_path,
  };
}

export async function listExports(
  admin: SupabaseClient,
  workspaceId: string,
  limit: number,
  cursorRaw: string | null,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  let q = admin
    .from("export_jobs")
    .select("id, format, status, row_count, requested_at, completed_at, storage_path")
    .eq("workspace_id", workspaceId)
    .order("requested_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  const cursor = decodeCursor(cursorRaw);
  if (cursor) q = afterKeyset(q, "requested_at", cursor);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(exportRow),
    nextCursor: hasMore && last ? encodeCursor(last.requested_at, last.id) : null,
  };
}

export async function getExportJob(
  admin: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<{ job: any; row: unknown } | null> {
  const { data } = await admin
    .from("export_jobs")
    .select("id, format, status, row_count, requested_at, completed_at, storage_path")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return { job: data, row: exportRow(data) };
}

// --- sync runs / events ------------------------------------------------

export async function listSyncRuns(
  admin: SupabaseClient,
  workspaceId: string,
  limit: number,
  cursorRaw: string | null,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  let q = admin
    .from("integration_sync_runs")
    .select(
      "id, trigger, direction, status, attempt, counts, started_at, finished_at, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  const cursor = decodeCursor(cursorRaw);
  if (cursor) q = afterKeyset(q, "created_at", cursor);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((r: any) => ({
      id: r.id,
      trigger: r.trigger,
      direction: r.direction,
      status: r.status,
      attempt: r.attempt,
      counts: r.counts ?? {},
      started_at: r.started_at ?? null,
      finished_at: r.finished_at ?? null,
      created_at: r.created_at,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function listEvents(
  admin: SupabaseClient,
  workspaceId: string,
  limit: number,
  cursorRaw: string | null,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  let q = admin
    .from("integration_events")
    .select("id, kind, severity, ref_type, ref_id, summary, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  const cursor = decodeCursor(cursorRaw);
  if (cursor) q = afterKeyset(q, "created_at", cursor);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((e: any) => ({
      id: e.id,
      kind: e.kind,
      severity: e.severity,
      ref_type: e.ref_type ?? null,
      ref_id: e.ref_id ?? null,
      summary: e.summary,
      created_at: e.created_at,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
