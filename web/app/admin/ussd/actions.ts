"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { assertPlatformAdmin, NotAuthorizedError } from "../../../lib/pay/admin";
import { assertPayServicesEnabled, FeatureDisabledError } from "../../../lib/pay/gate";

export type AdminActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

function mapError(err: unknown): AdminActionResult {
  if (err instanceof NotAuthorizedError) {
    return { ok: false, error: "You don't have access to this area." };
  }
  if (err instanceof FeatureDisabledError) {
    return { ok: false, error: "Pay & Services is turned off." };
  }
  return { ok: false, error: "Something went wrong." };
}

async function guard(): Promise<void> {
  await assertPlatformAdmin();
  assertPayServicesEnabled(await getActiveWorkspaceId());
}

/**
 * Create or update a service code (+ its parameters and steps) via the
 * SECURITY DEFINER RPC, which re-checks is_platform_admin() server-side,
 * bumps the version, and writes a snapshot + audit row. The client
 * assembles `payload` from the admin form.
 */
export async function adminUpsertServiceCode(
  payload: Record<string, unknown>,
): Promise<AdminActionResult> {
  try {
    await guard();
    const supabase = await supabaseSession();
    const { data, error } = await supabase.rpc("admin_upsert_service_code", {
      payload,
    });
    if (error) {
      if (/not_authorized/i.test(error.message)) {
        return { ok: false, error: "You don't have access to this area." };
      }
      return { ok: false, error: friendlyDbMessage(error.message) };
    }
    revalidatePath("/admin/ussd");
    revalidatePath("/pay/ussd");
    return { ok: true, id: data as string };
  } catch (err) {
    return mapError(err);
  }
}

export async function adminSetState(
  id: string,
  state: string,
  reason: string,
): Promise<AdminActionResult> {
  try {
    await guard();
    const supabase = await supabaseSession();
    const { error } = await supabase.rpc("admin_set_service_code_state", {
      p_id: id,
      p_state: state,
      p_reason: reason.trim() || null,
    });
    if (error) {
      if (/invalid_transition/i.test(error.message)) {
        return { ok: false, error: "That state change isn't allowed from here." };
      }
      if (/not_authorized/i.test(error.message)) {
        return { ok: false, error: "You don't have access to this area." };
      }
      return { ok: false, error: friendlyDbMessage(error.message) };
    }
    revalidatePath("/admin/ussd");
    revalidatePath(`/admin/ussd/${id}`);
    revalidatePath("/pay/ussd");
    return { ok: true };
  } catch (err) {
    return mapError(err);
  }
}

export async function adminResolveReport(
  reportId: string,
  status: string,
  note: string,
): Promise<AdminActionResult> {
  try {
    await guard();
    const supabase = await supabaseSession();
    const { error } = await supabase.rpc("admin_resolve_service_code_report", {
      p_id: reportId,
      p_status: status,
      p_note: note.trim() || null,
    });
    if (error) {
      return { ok: false, error: friendlyDbMessage(error.message) };
    }
    revalidatePath("/admin/ussd");
    return { ok: true };
  } catch (err) {
    return mapError(err);
  }
}

function friendlyDbMessage(raw: string): string {
  if (/duplicate key|unique/i.test(raw)) return "A code with that slug already exists.";
  if (/not_found/i.test(raw)) return "That record no longer exists.";
  if (/violates check constraint|check_violation/i.test(raw)) {
    return "One of the values isn't valid.";
  }
  return "Could not save the change.";
}
