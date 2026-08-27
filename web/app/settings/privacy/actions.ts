"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { DEFAULT_NAV_ORDER } from "../../../lib/navigation";

export type PrivacyActionResult = { ok: true } | { ok: false; error: string };

/**
 * Same read-then-merge upsert as app/settings/appearance/actions.ts's
 * upsertUiPreferences - duplicated rather than shared across the route
 * boundary (matches this codebase's existing per-settings-route actions
 * file convention, e.g. reports/actions.ts vs security/actions.ts never
 * importing each other). Display-privacy only: this never touches any
 * report/export/API authorization path (master prompt §6.5).
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
      "nav_order, hide_balance, privacy_mode, reports_relocation_notice_dismissed",
    )
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase.from("ui_preferences").upsert(
    {
      workspace_id: workspaceId,
      user_id: user.id,
      nav_order: existing?.nav_order ?? DEFAULT_NAV_ORDER,
      hide_balance: existing?.hide_balance ?? false,
      privacy_mode: existing?.privacy_mode ?? false,
      reports_relocation_notice_dismissed:
        existing?.reports_relocation_notice_dismissed ?? false,
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
