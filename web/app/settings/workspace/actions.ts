"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { generateInviteToken } from "../../../lib/credentials";
import { sendInviteEmail } from "../../../lib/emails";
import { siteUrl } from "../../../lib/site-url";
import { isSpacesEnabled } from "../../../lib/spaces/gate";
import { trackSpacesEvent } from "../../../lib/spaces/analytics";
import { getActiveWorkspaceId, type WorkspaceRole } from "../../../lib/queries";

export type WorkspaceActionResult = { ok: true } | { ok: false; error: string };
export type CreateInviteResult =
  | { ok: true; link: string; emailSent: boolean }
  | { ok: false; error: string };

const INVITE_ROLES = ["admin", "member", "viewer"] as const;

function isInviteRole(value: string): value is (typeof INVITE_ROLES)[number] {
  return (INVITE_ROLES as readonly string[]).includes(value);
}

/**
 * Sets the caller's active workspace for subsequent requests. Verifies
 * membership itself rather than trusting the RPC/table RLS alone to
 * reject a bad id silently - a rejected switch should tell the user it
 * failed, not just quietly leave them on their previous workspace.
 */
export async function setActiveWorkspace(
  workspaceId: string,
): Promise<WorkspaceActionResult> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "You're not a member of that workspace." };
  }

  const cookieStore = await cookies();
  cookieStore.set("active_workspace_id", workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Creates a new organization workspace, switches to it, and lands the
 * caller on its member/invite page. create_organization_workspace()
 * (supabase/migrations/20260827000000_organization_workspaces.sql)
 * creates the workspace and the caller's owner membership atomically.
 */
export async function createOrganization(name: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  const supabase = await supabaseSession();
  const { data: workspaceId, error } = await supabase.rpc(
    "create_organization_workspace",
    { p_name: trimmedName },
  );

  if (error || !workspaceId) return;

  trackSpacesEvent("household_created");
  await setActiveWorkspace(workspaceId);
  revalidatePath("/settings/workspace");
  redirect("/settings/workspace");
}

/**
 * Creates a household Space, switches to it, and lands the caller on its
 * member page. create_household_workspace()
 * (supabase/migrations/20260910000000_phase_q_spaces_foundation.sql,
 * re-issued in the Phase R migration to also log an activity/audit row)
 * creates the Space and the caller's owner membership atomically, and
 * inherits currency/timezone from the caller's profile.
 */
export async function createHousehold(name: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  // Spaces is gated (SPACES_ENABLED + allowlist). Off => silent no-op,
  // same as this function's existing error handling.
  if (!isSpacesEnabled(await getActiveWorkspaceId())) return;

  const supabase = await supabaseSession();
  const { data: workspaceId, error } = await supabase.rpc(
    "create_household_workspace",
    { p_name: trimmedName },
  );

  if (error || !workspaceId) return;

  trackSpacesEvent("household_created");
  await setActiveWorkspace(workspaceId);
  revalidatePath("/settings/workspace");
  redirect("/settings/workspace");
}

/**
 * Issues an invite for the active workspace. The link is returned to the
 * caller exactly once here - only token_hash/token_prefix are persisted,
 * same reveal-once contract as createConnection() in
 * app/settings/connections/actions.ts.
 */
export async function createInvite(
  workspaceId: string,
  email: string,
  role: string,
  workspaceName: string,
): Promise<CreateInviteResult> {
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    return { ok: false, error: "Enter an email address." };
  }

  if (!isInviteRole(role)) {
    return { ok: false, error: "Choose a valid role." };
  }

  const token = await generateInviteToken();

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to invite someone." };
  }

  // workspace_invites_insert_owner's RLS check requires invited_by =
  // auth.uid() - there's no column default, so this must be set
  // explicitly or every insert is rejected.
  const { error } = await supabase.from("workspace_invites").insert({
    workspace_id: workspaceId,
    email: trimmedEmail,
    role: role as WorkspaceRole,
    token_hash: token.hash,
    token_prefix: token.prefix,
    invited_by: user.id,
  });

  if (error) {
    return { ok: false, error: "Could not create the invite." };
  }

  trackSpacesEvent("member_invited", { role });

  const link = `${siteUrl()}/invite/${token.secret}`;
  const { ok: emailSent } = await sendInviteEmail({
    to: trimmedEmail,
    workspaceName,
    role,
    link,
  });

  revalidatePath("/settings/workspace");
  return { ok: true, link, emailSent };
}

export async function revokeInvite(
  inviteId: string,
): Promise<WorkspaceActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("workspace_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId);

  if (error) {
    return { ok: false, error: "Could not revoke the invite." };
  }

  revalidatePath("/settings/workspace");
  return { ok: true };
}

export async function changeMemberRole(
  membershipId: string,
  role: string,
): Promise<WorkspaceActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("set_member_role", {
    p_membership_id: membershipId,
    p_role: role,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  trackSpacesEvent("member_role_changed", { role });
  revalidatePath("/settings/workspace");
  return { ok: true };
}

export async function removeMember(
  membershipId: string,
): Promise<WorkspaceActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("remove_member", {
    p_membership_id: membershipId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  trackSpacesEvent("member_removed");
  revalidatePath("/settings/workspace");
  return { ok: true };
}
