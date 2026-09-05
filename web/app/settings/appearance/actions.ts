"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { LEGACY_DEFAULT_NAV_ORDER } from "../../../lib/navigation";

export type AppearanceActionResult = { ok: true } | { ok: false; error: string };

/**
 * Reads-then-merges the ui_preferences row so writing one setting can
 * never silently reset another. `nav_order` is no longer user-editable
 * (the primary nav is a fixed journey - lib/navigation.ts) but the column
 * still exists, so it is preserved / seeded with its legacy default here.
 */
async function upsertUiPreferences(
  patch: Record<string, unknown>,
): Promise<AppearanceActionResult> {
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
      "nav_order, hide_balance, privacy_mode, reports_relocation_notice_dismissed, onboarding_dismissed",
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
      reports_relocation_notice_dismissed:
        existing?.reports_relocation_notice_dismissed ?? false,
      onboarding_dismissed: existing?.onboarding_dismissed ?? false,
      ...patch,
    },
    { onConflict: "workspace_id,user_id" },
  );

  if (error) {
    console.error(
      "upsertUiPreferences (appearance) failed:",
      error.message,
      error.details,
      error.hint,
      error.code,
    );
    return { ok: false, error: "Could not save your preferences." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function dismissReportsRelocationNotice(): Promise<
  AppearanceActionResult
> {
  return upsertUiPreferences({ reports_relocation_notice_dismissed: true });
}
