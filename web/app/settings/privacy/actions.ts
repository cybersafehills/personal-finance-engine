"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { LEGACY_DEFAULT_NAV_ORDER } from "../../../lib/navigation";

export type PrivacyActionResult = { ok: true } | { ok: false; error: string };

/**
 * Read-then-merge upsert over the whole ui_preferences row - duplicated
 * per settings route rather than shared across the route boundary
 * (matches this codebase's existing per-settings-route actions file
 * convention, e.g. get-started/actions.ts, reports/actions.ts vs
 * security/actions.ts never importing each other). Display-privacy only:
 * this never touches any report/export/API authorization path (master
 * prompt §6.5).
 */
async function upsertUiPreferences(
  patch: Record<string, unknown>,
): Promise<PrivacyActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: existing } = await supabase
    .from("ui_preferences")
    .select(
      "nav_order, hide_balance, privacy_mode, onboarding_dismissed",
    )
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase.from("ui_preferences").upsert(
    {
      workspace_id: workspaceId,
      user_id: user.id,
      nav_order: existing?.nav_order ?? LEGACY_DEFAULT_NAV_ORDER,
      hide_balance: existing?.hide_balance ?? false,
      privacy_mode: existing?.privacy_mode ?? false,
      onboarding_dismissed: existing?.onboarding_dismissed ?? false,
      ...patch,
    },
    { onConflict: "workspace_id,user_id" },
  );

  if (error) {
    console.error("upsertUiPreferences (privacy) failed:", error.message, error.details, error.hint, error.code);
    return { ok: false, error: "Could not save your privacy preferences." };
  }

  revalidatePath("/", "layout");

  return { ok: true };
}

/** The Current Balance card's eye/eye-off control - "remember balance visibility" persisted across sessions/devices. */
export async function setHideBalance(hideBalance: boolean): Promise<PrivacyActionResult> {
  return upsertUiPreferences({ hide_balance: hideBalance });
}

/** Settings-only "Full financial privacy mode" toggle - conceals every sensitive dashboard figure, not just the main balance. */
export async function setPrivacyMode(privacyMode: boolean): Promise<PrivacyActionResult> {
  return upsertUiPreferences({ privacy_mode: privacyMode });
}
