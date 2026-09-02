import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Data fetch for an export run. Always called with the service-role
// client (it runs both in the createExportJob action and the
// run-export-jobs cron), so every query pins workspace_id explicitly -
// the "service-role code resolves explicit tenant scope" invariant.

export type ExportDirection = "in" | "out" | "neutral";

export type ExportFilters = {
  from: string;
  to: string;
  accountIds: string[] | null;
  directions: ExportDirection[] | null;
};

export type ExportTransactionRow = {
  id: string;
  occurredAt: string;
  description: string | null;
  reference: string | null;
  externalId: string | null;
  direction: ExportDirection;
  amountMinor: number;
  currency: string;
  category: string | null;
  accountId: string | null;
  accountName: string | null;
};

export type ExportDataset = {
  workspaceId: string;
  period: { from: string; to: string; label: string };
  transactions: ExportTransactionRow[];
  accounts: { id: string; name: string; currency: string }[];
};

const PAGE = 1000;
const HARD_CAP = 100_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
function baseQuery(admin: SupabaseClient, workspaceId: string, f: ExportFilters) {
  let q = admin
    .from("transactions")
    .select(
      "id, occurred_at, counterparty_name, counterparty_reference, external_transaction_id, direction, amount_rwf, currency, category, account_id",
    )
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .gte("occurred_at", f.from)
    .lte("occurred_at", f.to);
  if (f.accountIds && f.accountIds.length > 0) {
    q = q.in("account_id", f.accountIds);
  }
  if (f.directions && f.directions.length > 0) {
    q = q.in("direction", f.directions);
  }
  return q;
}

export async function countExportRows(
  admin: SupabaseClient,
  workspaceId: string,
  filters: ExportFilters,
): Promise<number> {
  const { count, error } = await admin
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .gte("occurred_at", filters.from)
    .lte("occurred_at", filters.to);
  if (error) {
    console.error("countExportRows failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function buildExportDataset(
  admin: SupabaseClient,
  workspaceId: string,
  filters: ExportFilters,
  periodLabel: string,
): Promise<ExportDataset> {
  const { data: accountRows } = await admin
    .from("accounts")
    .select("id, name, currency")
    .eq("workspace_id", workspaceId);
  const accounts = (accountRows ?? []).map((a: any) => ({
    id: a.id as string,
    name: a.name as string,
    currency: a.currency as string,
  }));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  const transactions: ExportTransactionRow[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    const { data, error } = await baseQuery(admin, workspaceId, filters)
      .order("occurred_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("buildExportDataset page failed:", error.message);
      break;
    }
    const rows = (data ?? []) as any[];
    for (const t of rows) {
      transactions.push({
        id: t.id,
        occurredAt: t.occurred_at,
        description: t.counterparty_name ?? null,
        reference: t.counterparty_reference ?? null,
        externalId: t.external_transaction_id ?? null,
        direction: t.direction,
        amountMinor: t.amount_rwf,
        currency: t.currency,
        category: t.category ?? null,
        accountId: t.account_id ?? null,
        accountName: t.account_id ? accountName.get(t.account_id) ?? null : null,
      });
    }
    if (rows.length < PAGE) break;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    workspaceId,
    period: { from: filters.from, to: filters.to, label: periodLabel },
    transactions,
    accounts,
  };
}
