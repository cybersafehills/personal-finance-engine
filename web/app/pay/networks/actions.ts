"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { assertUssdDirectoryEnabled, FeatureDisabledError } from "../../../lib/pay/gate";

// Per-user actions for the public payment-network route surface (P3).
// Mirrors app/pay/actions.ts exactly - the only writes this surface can
// do are favourite / usage / report. Never executes a payment.

export type PayActionResult = { ok: true } | { ok: false; error: string };

const USAGE_ACTIONS = ["viewed", "copied_code", "opened_dialer", "used_template"] as const;
const USAGE_OUTCOMES = ["dialer_opened", "dialer_unsupported", "copied", "fallback_shown"] as const;
const REPORT_TYPES = [
  "incorrect_code",
  "outdated",
  "wrong_prerequisites",
  "provider_changed",
  "other",
] as const;

async function currentUserId(): Promise<string | null> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function toggleRouteFavourite(
  accessRouteId: string,
): Promise<{ ok: true; favourited: boolean } | { ok: false; error: string }> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, error: "Sign in to save favourites." };

    const workspaceId = await getActiveWorkspaceId();
    assertUssdDirectoryEnabled(workspaceId);

    const supabase = await supabaseSession();
    const { data: existing } = await supabase
      .from("service_favourites")
      .select("id")
      .eq("access_route_id", accessRouteId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("service_favourites").delete().eq("id", existing.id);
      if (error) return { ok: false, error: "Could not update your favourites." };
      revalidatePath("/pay/networks", "layout");
      return { ok: true, favourited: false };
    }

    const { error } = await supabase.from("service_favourites").insert({
      user_id: userId,
      workspace_id: workspaceId,
      access_route_id: accessRouteId,
    });
    if (error) return { ok: false, error: "Could not update your favourites." };
    revalidatePath("/pay/networks", "layout");
    return { ok: true, favourited: true };
  } catch (err) {
    if (err instanceof FeatureDisabledError) {
      return { ok: false, error: "Pay & Services is turned off for your account." };
    }
    return { ok: false, error: "Something went wrong." };
  }
}

export async function recordRouteUsage(
  accessRouteId: string,
  action: (typeof USAGE_ACTIONS)[number],
  outcome?: (typeof USAGE_OUTCOMES)[number],
): Promise<PayActionResult> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, error: "Not signed in." };
    if (!(USAGE_ACTIONS as readonly string[]).includes(action)) {
      return { ok: false, error: "Unknown action." };
    }
    if (outcome && !(USAGE_OUTCOMES as readonly string[]).includes(outcome)) {
      return { ok: false, error: "Unknown outcome." };
    }
    const workspaceId = await getActiveWorkspaceId();
    assertUssdDirectoryEnabled(workspaceId);

    const supabase = await supabaseSession();
    await supabase.from("service_recent_usage").insert({
      user_id: userId,
      workspace_id: workspaceId,
      access_route_id: accessRouteId,
      action,
      capability_outcome: outcome ?? null,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record activity." };
  }
}

export async function reportRoute(
  accessRouteId: string,
  reportType: (typeof REPORT_TYPES)[number],
  details: string,
): Promise<PayActionResult> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, error: "Sign in to report a problem." };
    if (!(REPORT_TYPES as readonly string[]).includes(reportType)) {
      return { ok: false, error: "Choose what's wrong." };
    }
    const workspaceId = await getActiveWorkspaceId();
    assertUssdDirectoryEnabled(workspaceId);

    const supabase = await supabaseSession();
    const { error } = await supabase.from("service_code_reports").insert({
      access_route_id: accessRouteId,
      reporter_user_id: userId,
      workspace_id: workspaceId,
      report_type: reportType,
      details: details.trim().slice(0, 2000) || null,
    });
    if (error) {
      if (/rate_limited/i.test(error.message)) {
        return {
          ok: false,
          error: "You've sent several reports recently. Try again in a little while.",
        };
      }
      return { ok: false, error: "Could not send your report." };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof FeatureDisabledError) {
      return { ok: false, error: "Pay & Services is turned off for your account." };
    }
    return { ok: false, error: "Something went wrong." };
  }
}
