"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { generateIngestionCredential } from "../../../lib/credentials";
import { requireMfaForSensitiveAction } from "../../../lib/auth/assurance";
import { buildMtnMomoPairingIdentity } from "../../../lib/mtn-momo-pairing";

export type CreateConnectionResult =
  | { ok: true; secret: string }
  | { ok: false; error: string };

export type ConnectionActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function pairMtnMomoAdapterCanary(
  connectionId: string,
  msisdn: string,
): Promise<ConnectionActionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");

  let identity: Awaited<ReturnType<typeof buildMtnMomoPairingIdentity>>;
  try {
    identity = await buildMtnMomoPairingIdentity(msisdn);
  } catch {
    return { ok: false, error: "Enter a valid Rwanda MTN mobile number." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("pair_mtn_momo_adapter_canary", {
    p_ingestion_connection_id: connectionId,
    p_source_ref_hash: identity.sourceRefHash,
    p_account_ref_hash: identity.accountRefHash,
    p_masked_identifier: identity.maskedIdentifier,
  });

  if (error) {
    return {
      ok: false,
      error: error.message.includes("adapter_canary_slot_unavailable")
        ? "Another MTN installation is already using the canary slot."
        : "Could not pair this MTN installation for canary routing.",
    };
  }

  revalidatePath("/integrations/connections");
  return { ok: true };
}

export async function pairMtnMomoAdapterCanaryByInstallation(
  connectorInstallationId: string,
  msisdn: string,
): Promise<ConnectionActionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");

  let identity: Awaited<ReturnType<typeof buildMtnMomoPairingIdentity>>;
  try {
    identity = await buildMtnMomoPairingIdentity(msisdn);
  } catch {
    return { ok: false, error: "Enter a valid Rwanda MTN mobile number." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc(
    "pair_mtn_momo_adapter_canary_by_installation",
    {
      p_connector_installation_id: connectorInstallationId,
      p_source_ref_hash: identity.sourceRefHash,
      p_account_ref_hash: identity.accountRefHash,
      p_masked_identifier: identity.maskedIdentifier,
    },
  );

  if (error) {
    return {
      ok: false,
      error: error.message.includes("adapter_canary_slot_unavailable")
        ? "Another MTN installation is already using the canary slot."
        : "Could not pair this MTN installation for canary routing.",
    };
  }

  revalidatePath("/integrations/connections");
  return { ok: true };
}

export async function setMtnMomoAdapterCanaryEnabled(
  connectorInstallationId: string,
  enabled: boolean,
): Promise<ConnectionActionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc(
    "set_connector_adapter_canary_enabled",
    {
      p_connector_installation_id: connectorInstallationId,
      p_enabled: enabled,
    },
  );

  if (error) {
    return { ok: false, error: "Could not update the MTN canary." };
  }

  revalidatePath("/integrations/connections");
  return { ok: true };
}

/**
 * Creates a new ingestion connection, permanently bound to accountId at
 * creation time (the "bound account routing" model - see the Phase C
 * migration's own comments). The generated secret is returned to the
 * caller exactly once here and never again - it is not stored anywhere,
 * only its SHA-256 hash is. RLS (ingestion_connections_write_owner) plus
 * the ingestion_connections_account_same_workspace database constraint
 * are what actually prevent this from ever binding to an account outside
 * the caller's own workspace, independent of accountId's origin.
 */
export async function createConnection(
  label: string,
  provider: string,
  accountId: string,
): Promise<CreateConnectionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");
  const trimmedLabel = label.trim();

  if (!trimmedLabel) {
    return { ok: false, error: "Connection label cannot be empty." };
  }

  if (!accountId) {
    return { ok: false, error: "Choose an account for this connection." };
  }

  const workspaceId = await getActiveWorkspaceId();

  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const credential = await generateIngestionCredential();

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc(
    "create_ingestion_connection_dual_write",
    {
      p_workspace_id: workspaceId,
      p_account_id: accountId,
      p_label: trimmedLabel,
      p_provider: provider,
      p_credential_hash: credential.hash,
      p_credential_prefix: credential.prefix,
    },
  );

  if (error) {
    return { ok: false, error: "Could not create the connection." };
  }

  revalidatePath("/integrations/connections");

  return { ok: true, secret: credential.secret };
}

/** Rotates through the canonical history-preserving RPC. */
export async function rotateConnection(
  connectionId: string,
): Promise<CreateConnectionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");
  const credential = await generateIngestionCredential();

  const supabase = await supabaseSession();
  const { data: connection, error: mappingError } = await supabase
    .from("ingestion_connections")
    .select("device_credential_id")
    .eq("id", connectionId)
    .maybeSingle();

  if (mappingError || !connection?.device_credential_id) {
    return { ok: false, error: "Could not rotate the connection." };
  }

  const { error } = await supabase.rpc("rotate_device_credential", {
    p_device_credential_id: connection.device_credential_id,
    p_credential_hash: credential.hash,
    p_credential_prefix: credential.prefix,
  });

  if (error) {
    return { ok: false, error: "Could not rotate the connection." };
  }

  revalidatePath("/integrations/connections");

  return { ok: true, secret: credential.secret };
}

/** Revokes through the canonical installation boundary without deleting provenance. */
export async function revokeConnection(
  connectionId: string,
): Promise<ConnectionActionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");
  const supabase = await supabaseSession();
  const { data: connection, error: mappingError } = await supabase
    .from("ingestion_connections")
    .select("connector_installation_id")
    .eq("id", connectionId)
    .maybeSingle();

  if (mappingError || !connection?.connector_installation_id) {
    return { ok: false, error: "Could not revoke the connection." };
  }

  const { error } = await supabase.rpc("revoke_connector_installation", {
    p_connector_installation_id: connection.connector_installation_id,
  });

  if (error) {
    return { ok: false, error: "Could not revoke the connection." };
  }

  revalidatePath("/integrations/connections");

  return { ok: true };
}

/**
 * Pauses a connection (Phase U PR4). Reversible and non-destructive: the
 * credential is untouched, but ingest-momo's authenticateCredential
 * rejects any status other than 'active', so the device stops being able
 * to send transactions in until resumeConnection() is called. Nothing
 * already ingested is affected.
 */
export async function pauseConnection(
  connectionId: string,
): Promise<ConnectionActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("ingestion_connections")
    .update({ status: "paused", paused_at: new Date().toISOString() })
    .eq("id", connectionId);

  if (error) {
    return { ok: false, error: "Could not pause the connection." };
  }

  revalidatePath("/integrations/connections");

  return { ok: true };
}

/** Resumes a paused connection - back to 'active', paused_at cleared. */
export async function resumeConnection(
  connectionId: string,
): Promise<ConnectionActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("ingestion_connections")
    .update({ status: "active", paused_at: null })
    .eq("id", connectionId);

  if (error) {
    return { ok: false, error: "Could not resume the connection." };
  }

  revalidatePath("/integrations/connections");

  return { ok: true };
}

export type ConnectionReadinessResult =
  | {
    ok: true;
    status: "active" | "paused" | "revoked";
    lastUsedAt: string | null;
  }
  | { ok: false; error: string };

/**
 * Read-only poll behind the "waiting for your first message" state on a
 * freshly-created connection. The UI calls this every few seconds until
 * last_used_at is set (ingest-momo stamps it on the first accepted
 * message) or the connection leaves 'active'.
 *
 * There is deliberately no synthetic-send "test" here: the only honest
 * test of the wiring is a real MoMo SMS through the user's own Shortcut,
 * and ingest-momo has no test-message passthrough that would keep a
 * fabricated transaction out of the ledger. See
 * docs/onboarding-and-connections-design.md (PR3).
 */
export async function probeConnectionReadiness(
  connectionId: string,
): Promise<ConnectionReadinessResult> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("ingestion_connections")
    .select("status, last_used_at")
    .eq("id", connectionId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Could not check this connection." };
  }

  return {
    ok: true,
    status: data.status as "active" | "paused" | "revoked",
    lastUsedAt: (data.last_used_at as string | null) ?? null,
  };
}

export async function probeConnectorCredentialReadiness(
  credentialId: string,
): Promise<ConnectionReadinessResult> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("device_credentials")
    .select("status, last_used_at")
    .eq("id", credentialId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Could not check this credential." };
  }

  return {
    ok: true,
    status: data.status as "active" | "paused" | "revoked",
    lastUsedAt: (data.last_used_at as string | null) ?? null,
  };
}

/** Renames a connection. Label only - the bound account and credential are unchanged. */
export async function renameConnection(
  connectionId: string,
  label: string,
): Promise<ConnectionActionResult> {
  const trimmedLabel = label.trim();

  if (!trimmedLabel) {
    return { ok: false, error: "Connection label cannot be empty." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("ingestion_connections")
    .update({ label: trimmedLabel })
    .eq("id", connectionId);

  if (error) {
    return { ok: false, error: "Could not rename the connection." };
  }

  revalidatePath("/integrations/connections");

  return { ok: true };
}

/**
 * Stage D canonical lifecycle actions. These call owner-scoped database RPCs
 * so the installation, the credentials paused by it, and any Stage C legacy
 * compatibility row commit or roll back together.
 */
export async function pauseConnectorInstallation(
  connectorInstallationId: string,
): Promise<ConnectionActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("set_connector_installation_paused", {
    p_connector_installation_id: connectorInstallationId,
    p_paused: true,
  });

  if (error) {
    return { ok: false, error: "Could not pause the connector." };
  }

  revalidatePath("/integrations/connections");
  return { ok: true };
}

export async function resumeConnectorInstallation(
  connectorInstallationId: string,
): Promise<ConnectionActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("set_connector_installation_paused", {
    p_connector_installation_id: connectorInstallationId,
    p_paused: false,
  });

  if (error) {
    return { ok: false, error: "Could not resume the connector." };
  }

  revalidatePath("/integrations/connections");
  return { ok: true };
}

export async function renameConnectorInstallation(
  connectorInstallationId: string,
  displayName: string,
): Promise<ConnectionActionResult> {
  const trimmedDisplayName = displayName.trim();

  if (!trimmedDisplayName) {
    return { ok: false, error: "Connector name cannot be empty." };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("rename_connector_installation", {
    p_connector_installation_id: connectorInstallationId,
    p_display_name: trimmedDisplayName,
  });

  if (error) {
    return { ok: false, error: "Could not rename the connector." };
  }

  revalidatePath("/integrations/connections");
  return { ok: true };
}

export async function rotateConnectorCredential(
  deviceCredentialId: string,
): Promise<CreateConnectionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");
  const credential = await generateIngestionCredential();
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("rotate_device_credential", {
    p_device_credential_id: deviceCredentialId,
    p_credential_hash: credential.hash,
    p_credential_prefix: credential.prefix,
  });

  if (error) {
    return { ok: false, error: "Could not rotate the credential." };
  }

  revalidatePath("/integrations/connections");
  return { ok: true, secret: credential.secret };
}

export async function revokeConnectorInstallation(
  connectorInstallationId: string,
): Promise<ConnectionActionResult> {
  await requireMfaForSensitiveAction("/integrations/connections");
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("revoke_connector_installation", {
    p_connector_installation_id: connectorInstallationId,
  });

  if (error) {
    return { ok: false, error: "Could not revoke the connector." };
  }

  revalidatePath("/integrations/connections");
  return { ok: true };
}
