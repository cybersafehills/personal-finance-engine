"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../lib/queries";
import { LEGACY_DEFAULT_NAV_ORDER } from "../../lib/navigation";

export type InboxActionResult = { ok: true } | { ok: false; error: string };

/**
 * Read-then-merge upsert over the whole ui_preferences row - same
 * per-route convention as app/settings/privacy/actions.ts. Only touches
 * show_inbox_badge: whether the header inbox icon shows its count badge.
 */
export async function setInboxBadgePreference(
  enabled: boolean,
): Promise<InboxActionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: existing } = await supabase
    .from("ui_preferences")
    .select(
      "nav_order, hide_balance, privacy_mode, onboarding_dismissed, show_inbox_badge",
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
      show_inbox_badge: enabled,
    },
    { onConflict: "workspace_id,user_id" },
  );

  if (error) {
    console.error("setInboxBadgePreference failed:", error.message);
    return { ok: false, error: "Could not save that preference." };
  }

  // Layout (header badge) + both places the toggle is shown.
  revalidatePath("/", "layout");
  revalidatePath("/inbox");
  revalidatePath("/settings/notifications");
  return { ok: true };
}
