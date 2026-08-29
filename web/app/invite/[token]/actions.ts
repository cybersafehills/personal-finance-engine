"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { hashToken } from "../../../lib/credentials";
import { setActiveWorkspace } from "../../settings/workspace/actions";

export type AcceptInviteResult = { ok: true } | { ok: false; error: string };

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const tokenHash = await hashToken(token);
  const supabase = await supabaseSession();

  const { data: workspaceId, error } = await supabase.rpc(
    "accept_workspace_invite",
    { p_token_hash: tokenHash },
  );

  if (error || !workspaceId) {
    return { ok: false, error: "This invite is invalid or has expired." };
  }

  await setActiveWorkspace(workspaceId);
  // Land on the onboarding checklist - scoped to what this member
  // actually has to set up. For an organization member/viewer that has
  // nothing of their own to configure, getOnboardingState() reports the
  // checklist disabled and /get-started forwards to the dashboard.
  redirect("/get-started");
}
