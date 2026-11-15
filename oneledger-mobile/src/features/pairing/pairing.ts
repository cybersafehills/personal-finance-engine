import * as Crypto from "expo-crypto";

import { supabase } from "@/api/supabase";
import { captureIsDemo, pairDevice } from "@/features/capture/capture";

import {
  connectorKeyForProvider,
  generatePairingToken,
  startPairingErrorMessage,
} from "./pairing-token";

// Connecting this phone, from inside the app. Because the user is already
// signed in here, there is no code to type or scan: the app creates the
// one-time pairing session itself (the same database function the web
// wizard calls, which enforces "workspace owner only"), then hands the
// token straight to the native engine, which redeems it and keeps the
// resulting device secret. The token lives only in memory for that moment.

export type PairableAccount = {
  id: string;
  name: string;
  provider: string;
  workspaceId: string;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

const NOT_CONFIGURED = "This build isn't connected to OneLedger yet.";

/** Active MTN MoMo accounts the signed-in user can see (RLS-scoped). */
export async function listPairableAccounts(): Promise<
  { ok: true; accounts: PairableAccount[] } | { ok: false; message: string }
> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, provider, workspace_id, is_primary, created_at")
    .eq("is_active", true)
    .is("archived_at", null)
    // Only MoMo is recognised on the phone today (see ProviderMatchers).
    .eq("provider", "mtn_momo")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return { ok: false, message: "Couldn't load your accounts. Try again." };
  }
  return {
    ok: true,
    accounts: (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      provider: row.provider as string,
      workspaceId: row.workspace_id as string,
    })),
  };
}

export type StartedPairing = {
  /** The one-time code. Hold in memory only; never store or log it. */
  token: string;
  sessionId: string;
  /** Mirrors the server's 10-minute lifetime; for the countdown only. */
  expiresAtIso: string;
};

/**
 * Creates a one-time pairing session for `account` (the same database
 * function the web wizard calls; it enforces "workspace owner only").
 */
export async function startPairingSession(
  account: PairableAccount,
): Promise<({ ok: true } & StartedPairing) | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  const { token, prefix } = generatePairingToken((n) =>
    Crypto.getRandomBytes(n),
  );
  const tokenHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    token,
    { encoding: Crypto.CryptoEncoding.HEX },
  );

  const { data, error } = await supabase
    .rpc("create_device_pairing_session", {
      p_connector_key: connectorKeyForProvider(account.provider),
      p_provider: account.provider,
      p_home_workspace_id: account.workspaceId,
      p_label: account.name.slice(0, 80) || "Phone",
      p_token_hash: tokenHash,
      p_token_prefix: prefix,
      p_intended_account_id: account.id,
      p_connector_installation_id: null,
    })
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: startPairingErrorMessage(error?.message ?? "") };
  }
  return {
    ok: true,
    token,
    sessionId: String(data),
    expiresAtIso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

export type PairingSessionStatus = {
  status: "pending" | "consumed" | "expired" | "cancelled";
  /** The phone credential created when the code was redeemed. */
  deviceCredentialId: string | null;
};

/** Read-only poll; RLS limits it to the caller's own sessions. */
export async function getPairingSessionStatus(
  sessionId: string,
): Promise<PairingSessionStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("pairing_sessions")
    .select("status, consumed_device_credential_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    status: data.status as PairingSessionStatus["status"],
    deviceCredentialId: (data.consumed_device_credential_id as string | null) ?? null,
  };
}

/** When OneLedger last heard from a connected phone, or null if never. */
export async function getDeviceLastUsedAt(
  deviceCredentialId: string,
): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("device_credentials")
    .select("last_used_at")
    .eq("id", deviceCredentialId)
    .maybeSingle();
  return (data?.last_used_at as string | null) ?? null;
}

/** Creates a pairing session for `account` and redeems it on this phone. */
export async function connectThisPhone(
  account: PairableAccount,
): Promise<ActionResult> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  // The browser preview's demo engine must not create a real pairing
  // session on the server for a phone that does not exist.
  if (captureIsDemo) return pairDevice("demo");

  const started = await startPairingSession(account);
  if (!started.ok) return started;
  return pairDevice(started.token);
}
