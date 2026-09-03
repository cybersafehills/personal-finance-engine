"use server";

import { supabaseSession } from "../../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { requireMfaForSensitiveAction } from "../../../../lib/auth/assurance";
import {
  connectorKeyForProvider,
  generatePairingToken,
  hashPairingToken,
} from "../../../../lib/pairing";

const NEXT = "/integrations/connections/pair";

export type StartDevicePairingResult =
  | {
    ok: true;
    /** One-time pairing code, shown to the user once; also sent to the device. */
    token: string;
    /** `olp_XXXX` display fragment (safe to keep around). */
    prefix: string;
    sessionId: string;
    expiresAt: string;
  }
  | { ok: false; error: string };

/**
 * Records a pending pairing session for `accountId`'s workspace and returns the
 * one-time token. The plaintext token is generated here, hashed before it
 * touches the database, and returned to the caller exactly once. The device
 * (the OneLedger Capture Shortcut) redeems it against the `capture` Edge
 * Function; this action never sees the device's own secret.
 */
export async function startDevicePairing(
  accountId: string,
): Promise<StartDevicePairingResult> {
  await requireMfaForSensitiveAction(NEXT);

  if (!accountId) {
    return { ok: false, error: "Choose which account this phone should feed." };
  }

  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("name, provider, is_active, archived_at")
    .eq("id", accountId)
    .maybeSingle();

  if (
    accountError || !account || !account.is_active || account.archived_at
  ) {
    return { ok: false, error: "That account isn't available." };
  }

  const provider = account.provider as string;
  const { token, prefix } = generatePairingToken();
  const tokenHash = await hashPairingToken(token);

  const { data, error } = await supabase
    .rpc("create_device_pairing_session", {
      p_connector_key: connectorKeyForProvider(provider),
      p_provider: provider,
      p_home_workspace_id: workspaceId,
      p_label: (account.name as string).slice(0, 80) || "iPhone",
      p_token_hash: tokenHash,
      p_token_prefix: prefix,
      p_intended_account_id: accountId,
      p_connector_installation_id: null,
    })
    .maybeSingle<string>();

  if (error || !data) {
    const message = error?.message ?? "";
    if (message.includes("Only a workspace owner")) {
      return {
        ok: false,
        error: "Only a workspace owner can connect a device.",
      };
    }
    if (message.includes("Too many pending")) {
      return {
        ok: false,
        error:
          "You have a few pairing codes on the go already. Finish or wait for one to expire, then try again.",
      };
    }
    return { ok: false, error: "Could not start pairing. Please try again." };
  }

  return {
    ok: true,
    token,
    prefix,
    sessionId: data,
    // Mirrors the RPC's `now() + interval '10 minutes'`; used only for the
    // countdown copy, not as an authority (the DB re-checks on redemption).
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

export type DevicePairingStatus =
  | "pending"
  | "consumed"
  | "expired"
  | "cancelled";

export type GetDevicePairingStatusResult =
  | {
    ok: true;
    status: DevicePairingStatus;
    deviceCredentialId: string | null;
    expiresAt: string | null;
  }
  | { ok: false; error: string };

/** Read-only poll behind the pairing step. RLS confines it to the caller's own sessions. */
export async function getDevicePairingStatus(
  sessionId: string,
): Promise<GetDevicePairingStatusResult> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("pairing_sessions")
    .select("status, consumed_device_credential_id, expires_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Could not check the pairing status." };
  }

  return {
    ok: true,
    status: data.status as DevicePairingStatus,
    deviceCredentialId:
      (data.consumed_device_credential_id as string | null) ?? null,
    expiresAt: (data.expires_at as string | null) ?? null,
  };
}
