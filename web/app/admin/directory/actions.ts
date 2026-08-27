"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { NotAuthorizedError } from "../../../lib/pay/admin";
import {
  assertDirectoryAdmin,
  assertDirectoryPermission,
  type DirectoryPermission,
} from "../../../lib/pay/directory-perms";
import { resolveUserIdByEmail } from "../../../lib/directory/permissions-admin";
import { assertPayServicesEnabled, FeatureDisabledError } from "../../../lib/pay/gate";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

function friendly(raw: string): string {
  if (/not_authorized|insufficient_privilege/i.test(raw)) {
    return "You don't have the permission needed for that action.";
  }
  if (/invalid_transition/i.test(raw)) return "That state change isn't allowed from here.";
  if (/reason_required/i.test(raw)) {
    return "A public replacement explanation is required to deprecate a published record.";
  }
  if (/payment_secret_forbidden/i.test(raw)) {
    return "A menu step may not reference a PIN, OTP, or other secret.";
  }
  if (/duplicate key|unique/i.test(raw)) return "Something with that slug or key already exists.";
  if (/not_found|no_data_found/i.test(raw)) return "That record no longer exists.";
  if (/violates check constraint|check_violation|invalid_alias/i.test(raw)) {
    return "One of the values isn't valid.";
  }
  return "Could not save the change.";
}

function mapError(err: unknown): ActionResult {
  if (err instanceof NotAuthorizedError) {
    return { ok: false, error: "You don't have access to this area." };
  }
  if (err instanceof FeatureDisabledError) {
    return { ok: false, error: "Pay & Services is turned off." };
  }
  return { ok: false, error: "Something went wrong." };
}

async function runRpc(
  fn: string,
  args: Record<string, unknown>,
  perm: DirectoryPermission | null,
  revalidate: string[],
): Promise<ActionResult> {
  try {
    assertPayServicesEnabled(await getActiveWorkspaceId());
    if (perm) await assertDirectoryPermission(perm);
    else await assertDirectoryAdmin();

    const supabase = await supabaseSession();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, error: friendly(error.message) };
    for (const path of revalidate) revalidatePath(path);
    return { ok: true, id: typeof data === "string" ? data : undefined };
  } catch (err) {
    return mapError(err);
  }
}

const BASE = "/admin/directory";

// --- payment networks -----------------------------------------------

export async function upsertPaymentNetwork(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc(
    "admin_upsert_payment_network",
    { payload },
    payload.id ? "directory.edit_draft" : "directory.create",
    [`${BASE}/networks`, BASE],
  );
}

export async function setPaymentNetworkState(
  id: string,
  state: string,
  reason: string,
): Promise<ActionResult> {
  return runRpc(
    "admin_set_payment_network_state",
    { p_id: id, p_state: state, p_reason: reason.trim() || null },
    null,
    [`${BASE}/networks`, `${BASE}/networks/${id}`, BASE, "/pay/ussd"],
  );
}

export async function upsertNetworkOperator(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc(
    "admin_upsert_network_operator",
    { payload },
    payload.id ? "directory.edit_draft" : "directory.create",
    [`${BASE}/networks`],
  );
}

export async function upsertNetworkFee(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc("admin_upsert_network_fee", { payload }, "directory.edit_draft", [
    `${BASE}/networks`,
  ]);
}

export async function upsertNetworkLimit(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc("admin_upsert_network_limit", { payload }, "directory.edit_draft", [
    `${BASE}/networks`,
  ]);
}

// --- reference entities -------------------------------------------

export async function upsertRegulatoryAuthority(
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  return runRpc(
    "admin_upsert_regulatory_authority",
    { payload },
    payload.id ? "directory.edit_draft" : "directory.create",
    [BASE],
  );
}

export async function upsertServiceOperator(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc(
    "admin_upsert_service_operator",
    { payload },
    payload.id ? "directory.edit_draft" : "directory.create",
    [BASE],
  );
}

export async function upsertDirectorySource(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc(
    "admin_upsert_directory_source",
    { payload },
    payload.id ? "directory.edit_draft" : "directory.create",
    [BASE],
  );
}

// --- institution participation ---------------------------------

export async function upsertParticipation(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc(
    "admin_upsert_institution_participation",
    { payload },
    payload.id ? "directory.edit_draft" : "directory.create",
    [`${BASE}/institutions`, BASE],
  );
}

export async function setParticipationState(
  id: string,
  state: string,
  reason: string,
): Promise<ActionResult> {
  return runRpc(
    "admin_set_participation_state",
    { p_id: id, p_state: state, p_reason: reason.trim() || null },
    null,
    [`${BASE}/institutions`, `${BASE}/institutions/participation/${id}`, BASE],
  );
}

// --- access routes -------------------------------------------

export async function upsertAccessRoute(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc(
    "admin_upsert_access_route",
    { payload },
    payload.id ? "directory.edit_draft" : "directory.create",
    [`${BASE}/routes`, BASE, "/pay/ussd"],
  );
}

export async function setAccessRouteState(
  id: string,
  state: string,
  reason: string,
): Promise<ActionResult> {
  return runRpc(
    "admin_set_access_route_state",
    { p_id: id, p_state: state, p_reason: reason.trim() || null },
    null,
    [`${BASE}/routes`, `${BASE}/routes/${id}`, BASE, "/pay/ussd"],
  );
}

// --- evidence -----------------------------------------------

export async function attachEvidence(payload: Record<string, unknown>): Promise<ActionResult> {
  return runRpc("admin_attach_directory_evidence", { payload }, "directory.manage_evidence", [
    BASE,
  ]);
}

export async function detachEvidence(id: string, reason: string): Promise<ActionResult> {
  return runRpc(
    "admin_detach_directory_evidence",
    { p_id: id, p_reason: reason.trim() || null },
    "directory.manage_evidence",
    [BASE],
  );
}

// --- directory.* permission grants (platform-admin only) ----------

export async function grantDirectoryPermission(
  email: string,
  permission: string,
): Promise<ActionResult> {
  try {
    assertPayServicesEnabled(await getActiveWorkspaceId());
    const userId = await resolveUserIdByEmail(email.trim());
    if (!userId) return { ok: false, error: `No user found with email ${email.trim()}.` };
    const supabase = await supabaseSession();
    const { error } = await supabase.rpc("admin_grant_directory_permission", {
      p_user: userId,
      p_permission: permission,
      p_note: null,
    });
    if (error) return { ok: false, error: friendly(error.message) };
    revalidatePath(`${BASE}/permissions`);
    return { ok: true };
  } catch (err) {
    return mapError(err);
  }
}

export async function revokeDirectoryPermission(
  userId: string,
  permission: string,
): Promise<ActionResult> {
  try {
    assertPayServicesEnabled(await getActiveWorkspaceId());
    const supabase = await supabaseSession();
    const { error } = await supabase.rpc("admin_revoke_directory_permission", {
      p_user: userId,
      p_permission: permission,
    });
    if (error) return { ok: false, error: friendly(error.message) };
    revalidatePath(`${BASE}/permissions`);
    return { ok: true };
  } catch (err) {
    return mapError(err);
  }
}
