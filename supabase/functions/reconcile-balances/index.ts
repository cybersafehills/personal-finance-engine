// OneLedger balance-reconciliation population job (Integrations Phase 3,
// P3-PR2).
//
// Runs the canonical reconciliation engine
// (supabase/functions/_shared/reconciliation.ts) over each account's
// transactions and upserts one public.balance_reconciliations row per
// checkpoint, keyed by transaction_id so repeated runs are idempotent.
// The Reconciliation Center's "balance drift" section reads the result.
//
// No JWT: an internal job invoked by the run-balance-reconciliation cron
// with the service-role key as a bearer token, never by a browser. It is
// a hard 404 until the exact-match Edge Function secret is set:
//   BALANCE_RECONCILIATION_ENABLED = enabled
//
// This function only READS transactions and WRITES balance_reconciliations
// (a self-contained audit table). It never touches transactions.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildBalanceReconciliationRows,
  chunk,
  type LedgerTxnRow,
} from "./reconcile.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENABLED = Deno.env.get("BALANCE_RECONCILIATION_ENABLED") === "enabled";

// Per-account transaction ceiling. An account with more settled
// transactions than this is reconciled over its most recent window only -
// the running balance still bootstraps from the first reported balance in
// that window.
const MAX_TXNS_PER_ACCOUNT = 5000;
const UPSERT_CHUNK = 500;
const DEFAULT_ACCOUNT_LIMIT = 100;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** Constant-time-ish bearer check against the service-role key. */
function authorized(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token || !SERVICE_ROLE_KEY || token.length !== SERVICE_ROLE_KEY.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ SERVICE_ROLE_KEY.charCodeAt(i);
  }
  return diff === 0;
}

async function resolveAccountIds(
  requested: unknown,
  limit: number,
): Promise<string[]> {
  if (Array.isArray(requested) && requested.length > 0) {
    return requested.filter((v): v is string => typeof v === "string");
  }
  // Accounts that actually have at least one transaction, most-recently
  // active first.
  const { data, error } = await supabase
    .from("transactions")
    .select("account_id, occurred_at")
    .not("account_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`account discovery failed: ${error.message}`);
  const seen = new Set<string>();
  for (const row of (data ?? []) as { account_id: string | null }[]) {
    if (row.account_id) seen.add(row.account_id);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

async function reconcileAccount(
  accountId: string,
  calculatedAt: string,
): Promise<{ checkpoints: number }> {
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, occurred_at, created_at, balance_after_rwf, direction, status, amount_rwf, fee_rwf",
    )
    .eq("account_id", accountId)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_TXNS_PER_ACCOUNT);
  if (error) throw new Error(`txn read failed: ${error.message}`);

  const rows = buildBalanceReconciliationRows(
    accountId,
    (data ?? []) as LedgerTxnRow[],
    calculatedAt,
  );
  if (rows.length === 0) return { checkpoints: 0 };

  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error: upsertError } = await supabase
      .from("balance_reconciliations")
      .upsert(part, { onConflict: "transaction_id" });
    if (upsertError) {
      throw new Error(`upsert failed: ${upsertError.message}`);
    }
  }
  return { checkpoints: rows.length };
}

Deno.serve(async (req: Request) => {
  if (!ENABLED) return json({ ok: false, error: "not_found" }, 404);
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // An empty / non-JSON body is fine - run the default discovery sweep.
  }

  const limit = Number.isInteger(body.limit)
    ? Math.max(1, Math.min(body.limit as number, 1000))
    : DEFAULT_ACCOUNT_LIMIT;
  const calculatedAt = new Date().toISOString();

  try {
    const accountIds = await resolveAccountIds(body.account_ids, limit);
    let checkpoints = 0;
    const failures: { account_id: string; error: string }[] = [];
    for (const accountId of accountIds) {
      try {
        const result = await reconcileAccount(accountId, calculatedAt);
        checkpoints += result.checkpoints;
      } catch (err) {
        failures.push({
          account_id: accountId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return json({
      ok: failures.length === 0,
      accounts: accountIds.length,
      checkpoints,
      failures,
      calculated_at: calculatedAt,
    }, failures.length > 0 && checkpoints === 0 ? 500 : 200);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "reconcile_balances_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return json({ ok: false, error: "reconcile_failed" }, 500);
  }
});
