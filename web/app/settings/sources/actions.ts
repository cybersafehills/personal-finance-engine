"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isSpacesEnabled } from "../../../lib/spaces/gate";
import { trackSpacesEvent } from "../../../lib/spaces/analytics";

export type SourceActionResult = { ok: true } | { ok: false; error: string };

const SPACES_OFF: SourceActionResult = {
  ok: false,
  error: "Shared accounts aren't available yet.",
};

const VISIBILITY_MODES = [
  "personal_only",
  "share_transactions",
  "share_account",
] as const;
const SHARE_MODES = ["share_transactions", "share_account"] as const;
const LINK_STATUSES = ["active", "paused", "revoked"] as const;

function isVisibilityMode(v: string): v is (typeof VISIBILITY_MODES)[number] {
  return (VISIBILITY_MODES as readonly string[]).includes(v);
}
function isShareMode(v: string): v is (typeof SHARE_MODES)[number] {
  return (SHARE_MODES as readonly string[]).includes(v);
}
function isLinkStatus(v: string): v is (typeof LINK_STATUSES)[number] {
  return (LINK_STATUSES as readonly string[]).includes(v);
}

function friendlyError(message: string | undefined): string {
  // The RPCs raise plain-English messages already; surface them, but keep
  // a fallback so a Postgres-internal error never reaches the user.
  if (!message) return "Something went wrong. Try again.";
  return message.length > 200 ? "Something went wrong. Try again." : message;
}

/**
 * Sets the ceiling on what any Space may ever see of this source.
 * Narrowing cascades to existing share links inside set_source_visibility
 * (supabase/migrations/20260914000000_phase_s_shared_ledger_rpcs.sql);
 * ownership is enforced there, never trusted from the client.
 */
export async function setSourceVisibility(
  sourceId: string,
  mode: string,
): Promise<SourceActionResult> {
  if (!isVisibilityMode(mode)) {
    return { ok: false, error: "Unrecognized sharing option." };
  }

  if (!isSpacesEnabled(await getActiveWorkspaceId())) return SPACES_OFF;

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("set_source_visibility", {
    p_source_id: sourceId,
    p_visibility_mode: mode,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  if (mode === "personal_only") trackSpacesEvent("source_visibility_narrowed");
  revalidatePath("/settings/sources");
  return { ok: true };
}

/** Shares (or re-shares / changes the mode of) a source into one household. */
export async function allocateSourceToSpace(
  sourceId: string,
  workspaceId: string,
  mode: string,
  isDefault: boolean,
): Promise<SourceActionResult> {
  if (!isShareMode(mode)) {
    return { ok: false, error: "Choose what this Space can see." };
  }

  if (!isSpacesEnabled(await getActiveWorkspaceId())) return SPACES_OFF;

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("allocate_source_to_space", {
    p_source_id: sourceId,
    p_workspace_id: workspaceId,
    p_visibility_mode: mode,
    p_is_default: isDefault,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  trackSpacesEvent("source_shared", { mode, is_default: isDefault });
  revalidatePath("/settings/sources");
  return { ok: true };
}

/** Pauses, resumes, or revokes one share link. */
export async function setShareLinkStatus(
  sourceId: string,
  workspaceId: string,
  status: string,
): Promise<SourceActionResult> {
  if (!isLinkStatus(status)) {
    return { ok: false, error: "Unrecognized status." };
  }

  if (!isSpacesEnabled(await getActiveWorkspaceId())) return SPACES_OFF;

  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("set_source_space_link_status", {
    p_source_id: sourceId,
    p_workspace_id: workspaceId,
    p_status: status,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  trackSpacesEvent("source_share_status_changed", { status });
  revalidatePath("/settings/sources");
  return { ok: true };
}
