import "server-only";

import { supabaseSession } from "./supabase-session-server";

// Self-serve "give me all my data" export (master prompt §94, audit F12).
// A read-only bundle of the data the signed-in user owns or authored,
// assembled through the ordinary RLS-scoped session client - it can only
// ever return rows the caller was already allowed to see. Never
// plan-gated (assessment §7).
//
// Transactions are capped: an export is a convenience, not a bulk data
// pipeline (that is what /integrations/exports is for). The cap is
// recorded in the bundle so a truncated export is never silently partial.

const TRANSACTION_CAP = 10_000;

export type AccountDataExport = {
  exportedAt: string;
  /** 2 adds counterparties, balanceObservations and paymentRequests (OneLedger 3.0). */
  schemaVersion: 2;
  profile: Record<string, unknown> | null;
  workspaces: unknown[];
  financialSources: unknown[];
  accounts: unknown[];
  transactions: unknown[];
  transactionsTruncatedAt: number | null;
  categorizationRules: unknown[];
  budgets: unknown[];
  goals: unknown[];
  /** People/merchants resolved from transactions, with the identifiers used. */
  counterparties: unknown[];
  counterpartyIdentifiers: unknown[];
  /** Balances the user stated manually (provider-reported ones live on transactions). */
  balanceObservations: unknown[];
  /** Payment requests the user created, plus their history. The secret link
   *  token is never stored, so it cannot (and must not) appear here. */
  paymentRequests: unknown[];
  paymentRequestEvents: unknown[];
};

// Explicit columns, never "*": the payment_requests table holds a token digest
// that has no value to the user and must not leave the database.
const PAYMENT_REQUEST_COLUMNS =
  "id, workspace_id, amount_minor, currency, destination_type, destination_value, recipient_display, reference, expires_at, status, matched_transaction_id, cancelled_at, paid_marked_at, paid_marked_note, created_at";

export async function assembleAccountDataExport(): Promise<
  AccountDataExport | null
> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [
    profile,
    memberships,
    sources,
    accounts,
    transactions,
    rules,
    budgets,
    goals,
    counterparties,
    counterpartyIdentifiers,
    balanceObservations,
    paymentRequests,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_memberships")
      .select("workspace_id, role, status, joined_at, workspaces(name, kind)")
      .eq("user_id", user.id),
    supabase
      .from("financial_sources")
      .select("*")
      .eq("owner_user_id", user.id),
    supabase.from("accounts").select("*"),
    supabase
      .from("transactions")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(TRANSACTION_CAP),
    supabase.from("categorization_policies").select("*"),
    supabase.from("budgets").select("*"),
    supabase.from("financial_goals").select("*"),
    supabase.from("counterparties").select("*"),
    supabase.from("counterparty_identifiers").select("*"),
    supabase.from("balance_observations").select("*"),
    supabase
      .from("payment_requests")
      .select(PAYMENT_REQUEST_COLUMNS)
      .eq("created_by", user.id),
  ]);

  const requestIds = (paymentRequests.data ?? []).map((r) => r.id);
  const requestEvents = requestIds.length === 0 ? { data: [] } : await supabase
    .from("payment_request_events")
    .select("id, payment_request_id, event_type, created_at, metadata")
    .in("payment_request_id", requestIds);

  const txnRows = transactions.data ?? [];

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    profile: (profile.data as Record<string, unknown> | null) ?? null,
    workspaces: memberships.data ?? [],
    financialSources: sources.data ?? [],
    accounts: accounts.data ?? [],
    transactions: txnRows,
    transactionsTruncatedAt: txnRows.length === TRANSACTION_CAP
      ? TRANSACTION_CAP
      : null,
    categorizationRules: rules.data ?? [],
    budgets: budgets.data ?? [],
    goals: goals.data ?? [],
    counterparties: counterparties.data ?? [],
    counterpartyIdentifiers: counterpartyIdentifiers.data ?? [],
    balanceObservations: balanceObservations.data ?? [],
    paymentRequests: paymentRequests.data ?? [],
    paymentRequestEvents: requestEvents.data ?? [],
  };
}
