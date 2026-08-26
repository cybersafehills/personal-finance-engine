"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import {
  DEFAULT_NAV_ORDER,
  isValidNavOrder,
  type NavKey,
} from "../../../lib/navigation";

export type NavOrderActionResult = { ok: true } | { ok: false; error: string };

/**
 * Upserts only the nav_order column, preserving whatever privacy columns
 * already exist on the row (or their defaults, for a first-time row) -
 * see ui_preferences_actions.ts pattern note: every action here reads-
 * then-merges rather than upserting a partial row, so saving one setting
 * (say, navigation order) can never silently reset another (say, an
 * already-enabled privacy mode) back to its default.
 */
async function upsertUiPreferences(
  patch: Record<string, unknown>,
): Promise<NavOrderActionResult> {
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
    return { ok: false, error: "Could not save your preferences." };
  }

  // Every route reads its own nav order via the shared layout, so a
  // single revalidation of the root layout keeps mobile/desktop nav and
  // any settings preview in sync without a full page reload.
  revalidatePath("/", "layout");

  return { ok: true };
}

/**
 * Validates strictly rather than silently normalizing: the settings UI
 * only ever constructs a well-formed permutation of the four allowed
 * destinations, so a malformed payload here means a bug or a tampered
 * request, not a legitimate partial input worth guessing at.
 */
export async function saveNavOrder(order: NavKey[]): Promise<NavOrderActionResult> {
  if (!isValidNavOrder(order)) {
    return {
      ok: false,
      error: "Navigation order must include Transactions, Categories, Budgets, and Settings exactly once each.",
    };
  }

  return upsertUiPreferences({ nav_order: order });
}

export async function restoreDefaultNavOrder(): Promise<NavOrderActionResult> {
  return upsertUiPreferences({ nav_order: DEFAULT_NAV_ORDER });
}

export async function dismissReportsRelocationNotice(): Promise<NavOrderActionResult> {
  return upsertUiPreferences({ reports_relocation_notice_dismissed: true });
}
