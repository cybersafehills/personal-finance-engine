import "server-only";

import { generateInviteToken } from "../credentials";
import { sendInviteEmail } from "../emails";
import type { WorkspaceRole } from "../queries";
import { siteUrl } from "../site-url";
import { trackSpacesEvent } from "./analytics";
import { logSpacesError } from "./monitoring";
import type { supabaseSession } from "../supabase-session-server";

// Creating an invite, shared by the web server action and the mobile route
// (POST /api/mobile/spaces/invites) so there is one code path: the token is
// generated here, only its hash and prefix are stored, and the link (the only
// place the secret exists) is returned once and never logged.
//
// Authorisation is not decided here. The caller has already passed its own
// step-up (the web's requireMfaForSensitiveAction, the mobile guard's second
// factor), and the insert is bounded by the workspace_invites RLS policy
// (a member with the members.manage capability, invited_by = the caller).

type Supabase = Awaited<ReturnType<typeof supabaseSession>>;

export type CreateInviteCoreResult =
  | { ok: true; link: string; emailSent: boolean }
  | { ok: false; error: string };

export async function createWorkspaceInvite(params: {
  supabase: Supabase;
  workspaceId: string;
  /** The signed-in user (`invited_by`). Taken from the caller, not from a bare getUser(). */
  userId: string;
  userEmail: string | null;
  email: string;
  role: "admin" | "member" | "viewer";
  /** Fallback only: the name is read from the workspace row, which the caller cannot forge. */
  workspaceNameHint?: string;
}): Promise<CreateInviteCoreResult> {
  const { supabase, workspaceId, userId, userEmail, email, role } = params;
  const token = await generateInviteToken();

  // RLS: invited_by must equal the caller, and there is no column default.
  const { error } = await supabase.from("workspace_invites").insert({
    workspace_id: workspaceId,
    email,
    role: role as WorkspaceRole,
    token_hash: token.hash,
    token_prefix: token.prefix,
    invited_by: userId,
  });
  if (error) {
    logSpacesError("invite", error);
    return { ok: false, error: "Could not create the invite." };
  }

  trackSpacesEvent("member_invited", { role });

  const { data: ws } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  const workspaceName = (ws as { name?: string } | null)?.name ?? params.workspaceNameHint ??
    "the workspace";

  const link = `${siteUrl()}/invite/${token.secret}`;
  const { ok: emailSent } = await sendInviteEmail({
    to: email,
    workspaceName,
    role,
    link,
    invitedByEmail: userEmail,
    workspaceId,
  });

  return { ok: true, link, emailSent };
}
