"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../lib/queries";
import {
  assertUssdDirectoryEnabled,
  FeatureDisabledError,
  isUssdDirectoryEnabled,
} from "../../lib/pay/gate";
import { getFavourites, getRecentServices } from "../../lib/ussd/queries";

export type LauncherEntry = {
  slug: string;
  name: string;
  ussd_template: string;
  provider: string;
};

export type LauncherSnapshot = {
  favourites: LauncherEntry[];
  recent: LauncherEntry[];
};

/**
 * Lazily loaded when the Pay launcher opens, so the root layout doesn't
 * pay for this fetch on every page. Returns only the compact fields the
 * launcher shows.
 */
export async function getLauncherSnapshot(): Promise<LauncherSnapshot> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isUssdDirectoryEnabled(workspaceId)) {
    return { favourites: [], recent: [] };
  }
  const [favourites, recent] = await Promise.all([
    getFavourites(),
    getRecentServices(1),
  ]);
  const toEntry = (c: {
    slug: string;
    display_name_en: string;
    ussd_template: string;
    provider: { display_name: string };
  }): LauncherEntry => ({
    slug: c.slug,
    name: c.display_name_en,
    ussd_template: c.ussd_template,
    provider: c.provider.display_name,
  });
  return {
    favourites: favourites.slice(0, 5).map(toEntry),
    recent: recent.map(toEntry),
  };
}

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

/**
 * Star / unstar a service code for the signed-in user. Never executes a
 * payment - this is the only kind of write the directory browse surface
 * can do, alongside recordUsage and reportServiceCode.
 */
export async function toggleFavourite(
  serviceCodeId: string,
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
      .eq("service_code_id", serviceCodeId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("service_favourites")
        .delete()
        .eq("id", existing.id);
      if (error) return { ok: false, error: "Could not update your favourites." };
      revalidatePath("/pay/ussd");
      return { ok: true, favourited: false };
    }

    const { error } = await supabase.from("service_favourites").insert({
      user_id: userId,
      workspace_id: workspaceId,
      service_code_id: serviceCodeId,
    });
    if (error) return { ok: false, error: "Could not update your favourites." };
    revalidatePath("/pay/ussd");
    return { ok: true, favourited: true };
  } catch (err) {
    if (err instanceof FeatureDisabledError) {
      return { ok: false, error: "Pay & Services is turned off for your account." };
    }
    return { ok: false, error: "Something went wrong." };
  }
}

/**
 * Record a privacy-safe usage event (which code, what action / capability
 * outcome). The DB column set makes it impossible to store a phone
 * number, amount, or filled USSD string here - only the enums below.
 * Best-effort: a failure never blocks the user's actual task.
 */
export async function recordUsage(
  serviceCodeId: string,
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
      service_code_id: serviceCodeId,
      action,
      capability_outcome: outcome ?? null,
    });
    revalidatePath("/pay/ussd");
    return { ok: true };
  } catch {
    // Deliberately swallowed - usage recording is a convenience, not a
    // gate on anything the user is trying to do.
    return { ok: false, error: "Could not record activity." };
  }
}

/**
 * File a "this code is wrong" report. RLS enforces reporter_user_id =
 * auth.uid(); a BEFORE INSERT trigger enforces the <=5 open-per-hour
 * rate limit (surfaced here as a friendly message).
 */
export async function reportServiceCode(
  serviceCodeId: string,
  reportType: (typeof REPORT_TYPES)[number],
  details: string,
): Promise<PayActionResult> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, error: "Sign in to report a code." };
    if (!(REPORT_TYPES as readonly string[]).includes(reportType)) {
      return { ok: false, error: "Choose what's wrong with the code." };
    }

    const workspaceId = await getActiveWorkspaceId();
    assertUssdDirectoryEnabled(workspaceId);

    const supabase = await supabaseSession();
    const { error } = await supabase.from("service_code_reports").insert({
      service_code_id: serviceCodeId,
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
