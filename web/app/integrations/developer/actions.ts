"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { generateApiKey } from "../../../lib/credentials";
import { isDeveloperApiEnabled } from "../../../lib/integrations/gate";
import { normalizeScopes } from "../../../lib/api/keys";

type AccessOk = { ok: true; workspaceId: string; userId: string };
type AccessErr = { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

async function requireDeveloperAccess(): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isDeveloperApiEnabled(workspaceId)) {
    return { ok: false, error: "The developer API isn’t enabled for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.developer_manage",
  });
  if (error || allowed !== true) {
    return { ok: false, error: "You don’t have permission to manage API keys." };
  }
  return { ok: true, workspaceId, userId: user.id };
}

export type CreateApiKeyResult =
  | { ok: true; keyId: string; secret: string }
  | { ok: false; error: string };

export async function createApiKey(input: {
  name: string;
  scopes: unknown;
}): Promise<CreateApiKeyResult> {
  const access = await requireDeveloperAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const name = (input.name ?? "").trim();
  if (!name || name.length > 80) {
    return { ok: false, error: "Give the key a short name." };
  }
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) {
    return { ok: false, error: "Pick at least one scope." };
  }

  const { secret, hash, prefix } = await generateApiKey();
  const admin = supabaseServer();
  const { data: key, error } = await admin
    .from("api_keys")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name,
      key_prefix: prefix,
      key_hash: hash,
      scopes,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !key) {
    console.error("createApiKey insert failed:", error?.message);
    return { ok: false, error: "Could not create the API key." };
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "api_key.created",
    severity: "info",
    ref_type: "api_key",
    ref_id: key.id,
    summary: `API key "${name}" created (${scopes.join(", ")})`,
    context: { actorUserId: userId, scopes },
  });

  revalidatePath("/integrations/developer");
  // The plaintext token is returned exactly once - never stored, never
  // logged, never returned again.
  return { ok: true, keyId: key.id, secret };
}

export async function renameApiKey(
  keyId: string,
  name: string,
): Promise<SimpleResult> {
  const access = await requireDeveloperAccess();
  if (!access.ok) return access;
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed.length > 80) {
    return { ok: false, error: "Give the key a short name." };
  }
  const admin = supabaseServer();
  const { error } = await admin
    .from("api_keys")
    .update({ name: trimmed })
    .eq("id", keyId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not rename the key." };
  revalidatePath("/integrations/developer");
  return { ok: true };
}

export async function revokeApiKey(keyId: string): Promise<SimpleResult> {
  const access = await requireDeveloperAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { data: updated, error } = await admin
    .from("api_keys")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("workspace_id", access.workspaceId)
    .eq("status", "active")
    .select("id, name");
  if (error) return { ok: false, error: "Could not revoke the key." };
  if (updated && updated.length > 0) {
    await admin.from("integration_events").insert({
      workspace_id: access.workspaceId,
      kind: "api_key.revoked",
      severity: "info",
      ref_type: "api_key",
      ref_id: keyId,
      summary: `API key "${updated[0].name}" revoked`,
      context: { actorUserId: access.userId },
    });
  }
  revalidatePath("/integrations/developer");
  return { ok: true };
}
