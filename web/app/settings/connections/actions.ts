"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { generateIngestionCredential } from "../../../lib/credentials";

export type CreateConnectionResult =
  | { ok: true; secret: string }
  | { ok: false; error: string };

export type ConnectionActionResult =
  | { ok: true }
  | { ok: false; error: string };

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
  const { error } = await supabase.from("ingestion_connections").insert({
    workspace_id: workspaceId,
    account_id: accountId,
    label: trimmedLabel,
    provider,
    credential_hash: credential.hash,
    credential_prefix: credential.prefix,
  });

  if (error) {
    return { ok: false, error: "Could not create the connection." };
  }

  revalidatePath("/settings/connections");

  return { ok: true, secret: credential.secret };
}

/**
 * Rotates a connection's credential: a fresh secret replaces the old one
 * in place (same connection id, same bound account, same label) - the old
 * credential stops working the instant this update commits, since
 * ingest-momo looks up connections by credential_hash and the old hash no
 * longer matches any row.
 */
export async function rotateConnection(
  connectionId: string,
): Promise<CreateConnectionResult> {
  const credential = await generateIngestionCredential();

  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("ingestion_connections")
    .update({
      credential_hash: credential.hash,
      credential_prefix: credential.prefix,
    })
    .eq("id", connectionId);

  if (error) {
    return { ok: false, error: "Could not rotate the connection." };
  }

  revalidatePath("/settings/connections");

  return { ok: true, secret: credential.secret };
}

/**
 * Revokes a connection. Never deleted (see the migration: no delete
 * policy exists for ingestion_connections at all), so provenance of any
 * transaction already ingested through it is preserved. A revoked
 * connection's credential stops authenticating immediately.
 */
export async function revokeConnection(
  connectionId: string,
): Promise<ConnectionActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("ingestion_connections")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", connectionId);

  if (error) {
    return { ok: false, error: "Could not revoke the connection." };
  }

  revalidatePath("/settings/connections");

  return { ok: true };
}
