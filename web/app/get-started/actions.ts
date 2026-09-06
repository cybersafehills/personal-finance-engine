"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../lib/queries";
import { LEGACY_DEFAULT_NAV_ORDER } from "../../lib/navigation";
import { trackOnboardingEvent } from "../../lib/onboarding/analytics";

export type OnboardingActionResult = { ok: true } | { ok: false; error: string };

/**
 * Marks the onboarding checklist reminder dismissed for the caller in
 * their active workspace. Read-then-merge over the whole ui_preferences
 * row (same pattern as appearance/privacy actions) so dismissing the
 * checklist never resets nav order or a privacy toggle.
 */
export async function dismissOnboardingChecklist(): Promise<
  OnboardingActionResult
> {
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

  const { error: completionError } = await supabase.rpc(
    "complete_profile_onboarding",
  );
  if (completionError) {
    console.error("complete_profile_onboarding failed:", completionError.message);
    return { ok: false, error: "Could not finish setup." };
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
      nav_order: existing?.nav_order ?? LEGACY_DEFAULT_NAV_ORDER,
      hide_balance: existing?.hide_balance ?? false,
      privacy_mode: existing?.privacy_mode ?? false,
      reports_relocation_notice_dismissed:
        existing?.reports_relocation_notice_dismissed ?? false,
      onboarding_dismissed: true,
    },
    { onConflict: "workspace_id,user_id" },
  );

  if (error) {
    console.error("dismissOnboardingChecklist failed:", error.message);
    return { ok: false, error: "Could not dismiss the checklist." };
  }

  trackOnboardingEvent("onboarding_dismissed");
  revalidatePath("/", "layout");
  revalidatePath("/get-started");
  return { ok: true };
}
