"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";

export type AccountActionResult = { ok: true } | { ok: false; error: string };

const PROVIDERS = ["mtn_momo", "airtel_money", "bank", "other"] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Creates a new account in the caller's own workspace. RLS
 * (accounts_write_owner) is what actually enforces that only a workspace
 * owner can do this and that the account lands in their own workspace -
 * this only supplies the workspace_id, resolved from the caller's own
 * membership, never from anything client-submitted.
 */
export async function createAccount(
  name: string,
  provider: string,
  currency: string,
): Promise<AccountActionResult> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return { ok: false, error: "Account name cannot be empty." };
  }

  if (!isProvider(provider)) {
    return { ok: false, error: "Unrecognized account provider." };
  }

  const trimmedCurrency = currency.trim().toUpperCase();

  if (trimmedCurrency.length !== 3) {
    return { ok: false, error: "Currency must be a 3-letter code, e.g. RWF." };
  }

  const workspaceId = await getActiveWorkspaceId();

  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.from("accounts").insert({
    workspace_id: workspaceId,
    name: trimmedName,
    provider,
    currency: trimmedCurrency,
  });

  if (error) {
    return { ok: false, error: "Could not create the account." };
  }

  revalidatePath("/settings/accounts");
  revalidatePath("/integrations/connections");

  return { ok: true };
}

export async function renameAccount(
  accountId: string,
  name: string,
): Promise<AccountActionResult> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return { ok: false, error: "Account name cannot be empty." };
  }

  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return { ok: false, error: "Could not resolve your workspace." };

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("manage_wallet", {
    p_workspace_id: workspaceId,
    p_account_id: accountId,
    p_action: "rename",
    p_name: trimmedName,
  });

  if (error) {
    return { ok: false, error: "Could not rename the account." };
  }

  revalidatePath("/settings/accounts");
  revalidatePath("/integrations/connections");

  return { ok: true };
}

/**
 * Makes the account primary through the atomic owner/source/AAL-checked RPC.
 * The database locks the Space and changes both flags in one transaction, so
 * a denied target cannot clear the existing default.
 */
export async function setPrimaryAccount(
  accountId: string,
): Promise<AccountActionResult> {
  const workspaceId = await getActiveWorkspaceId();

  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();

  const { error } = await supabase.rpc("set_default_wallet", { p_workspace_id: workspaceId, p_account_id: accountId });
  if (error) return { ok: false, error: "Could not change the default wallet. Check your permissions and two-step verification." };

  revalidatePath("/settings/accounts");

  return { ok: true };
}

/**
 * Archives an account. Never deletes it or its transactions - financial
 * history is preserved unconditionally (see the migration's own comments
 * on accounts.archived_at). Also clears is_primary: an archived account
 * cannot remain the workspace's default, and a connection still bound to
 * it is rejected by ingest-momo rather than silently rerouted (see
 * ACCOUNT_UNAVAILABLE in supabase/functions/ingest-momo/index.ts).
 */
export async function archiveAccount(
  accountId: string,
): Promise<AccountActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return { ok: false, error: "Could not resolve your workspace." };

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("manage_wallet", {
    p_workspace_id: workspaceId,
    p_account_id: accountId,
    p_action: "archive",
  });

  if (error) {
    return { ok: false, error: "Could not archive the account." };
  }

  revalidatePath("/settings/accounts");
  revalidatePath("/integrations/connections");

  return { ok: true };
}

export async function restoreAccount(accountId: string): Promise<AccountActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return { ok: false, error: "Could not resolve your workspace." };

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("manage_wallet", {
    p_workspace_id: workspaceId,
    p_account_id: accountId,
    p_action: "restore",
  });
  if (error) return { ok: false, error: "Could not restore the wallet. Check your permissions and two-step verification." };
  revalidatePath("/settings/accounts");
  revalidatePath("/integrations/connections");
  return { ok: true };
}
