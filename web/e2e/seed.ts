import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertNotProductionSupabaseUrl } from "./production-guard";
import { E2E_USER } from "./test-users";

/**
 * Service-role helpers for specs that need a couple of `transactions`
 * rows to exist for the seeded test user (the suite otherwise creates no
 * ledger data). Same hard rule as auth.setup.ts / production-guard.ts:
 * only ever the disposable local Supabase stack, never the linked
 * production project.
 */
function resolveLocalSupabaseCredentials(): {
  url: string;
  serviceRoleKey: string;
} {
  if (
    process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      url: process.env.E2E_SUPABASE_URL,
      serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY,
    };
  }
  const raw = execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "..", ".."),
  });
  const status = JSON.parse(raw) as {
    API_URL?: string;
    SERVICE_ROLE_KEY?: string;
  };
  if (!status.API_URL || !status.SERVICE_ROLE_KEY) {
    throw new Error(
      "Could not resolve a local Supabase API URL/service-role key from " +
        "`supabase status`. Run `supabase start` first.",
    );
  }
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

export function adminClient(): SupabaseClient {
  const { url, serviceRoleKey } = resolveLocalSupabaseCredentials();
  assertNotProductionSupabaseUrl(url);
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function testUserId(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === E2E_USER.email);
  if (!user) throw new Error("E2E user not provisioned - run the setup project first.");
  return user.id;
}

/**
 * The test user's personal workspace + a single active RWF account,
 * creating the account on first call. Idempotent across specs / re-runs.
 */
export async function ensureWorkspaceAndAccount(
  admin: SupabaseClient = adminClient(),
): Promise<{ workspaceId: string; accountId: string }> {
  const userId = await testUserId(admin);

  // The test user has exactly one workspace - the personal one
  // handle_new_user() provisions (auth.setup.ts creates no orgs).
  const { data: membership, error: mErr } = await admin
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (mErr || !membership) {
    throw new Error(`Could not resolve the test user's workspace: ${mErr?.message}`);
  }
  const workspaceId = membership.workspace_id as string;

  const { data: existing } = await admin
    .from("accounts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { workspaceId, accountId: existing.id as string };

  const { data: created, error: aErr } = await admin
    .from("accounts")
    .insert({
      name: "E2E MoMo",
      provider: "mtn_momo",
      currency: "RWF",
      workspace_id: workspaceId,
      is_active: true,
    })
    .select("id")
    .single();
  if (aErr || !created) throw new Error(`Could not create a test account: ${aErr?.message}`);
  return { workspaceId, accountId: created.id as string };
}

export type SeedTxn = {
  transactionType?: string;
  direction?: "in" | "out";
  amountRwf?: number;
  feeRwf?: number;
  counterpartyName?: string | null;
  counterpartyReference?: string | null;
  category?: string | null;
  occurredAt?: string;
  /** Per-spec tag, written to parser_version so cleanup is scoped and
   * parallel spec files don't wipe each other's rows. */
  tag?: string;
};

/** Inserts one settled transaction for the test user. Returns its id. */
export async function seedTransaction(
  txn: SeedTxn,
  admin: SupabaseClient = adminClient(),
): Promise<string> {
  const { workspaceId, accountId } = await ensureWorkspaceAndAccount(admin);
  const direction = txn.direction ?? "out";
  const amount = txn.amountRwf ?? 1000;
  const fee = txn.feeRwf ?? 0;
  const principalEffect = direction === "out" ? -amount : amount;
  const feeEffect = direction === "out" ? -fee : 0;

  const { data, error } = await admin
    .from("transactions")
    .insert({
      account_id: accountId,
      workspace_id: workspaceId,
      source: "manual",
      transaction_type: txn.transactionType ?? "send_money",
      direction,
      status: "success",
      currency: "RWF",
      amount_rwf: amount,
      fee_rwf: fee,
      principal_effect_rwf: principalEffect,
      fee_effect_rwf: feeEffect,
      settlement_state: "settled",
      affects_balance: true,
      effect_reason: "manual_entry",
      counterparty_name: txn.counterpartyName ?? "Seed Counterparty",
      counterparty_reference: txn.counterpartyReference ?? null,
      occurred_at: txn.occurredAt ?? new Date().toISOString(),
      category: txn.category ?? null,
      category_source: txn.category ? "manual" : null,
      parser_version: txn.tag ? `e2e-seed:${txn.tag}` : "e2e-seed:default",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedTransaction failed: ${error?.message}`);
  return data.id as string;
}

/**
 * Removes e2e-seeded transactions. Pass the same `tag` the spec seeded
 * with so parallel spec files never wipe each other's rows.
 */
export async function cleanupSeededTransactions(
  tag: string,
  admin: SupabaseClient = adminClient(),
): Promise<void> {
  await admin
    .from("transactions")
    .delete()
    .eq("parser_version", `e2e-seed:${tag}`);
}
