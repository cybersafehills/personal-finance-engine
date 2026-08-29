"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { hashToken } from "../../../lib/credentials";
import { setActiveWorkspace } from "../../settings/workspace/actions";
import { trackSpacesEvent } from "../../../lib/spaces/analytics";
import { logSpacesError } from "../../../lib/spaces/monitoring";

export type AcceptInviteResult = { ok: true } | { ok: false; error: string };

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const tokenHash = await hashToken(token);
  const supabase = await supabaseSession();

  const { data: workspaceId, error } = await supabase.rpc(
    "accept_workspace_invite",
    { p_token_hash: tokenHash },
  );

  if (error || !workspaceId) {
    if (error) logSpacesError("accept_invite", error);
    return { ok: false, error: "This invite is invalid or has expired." };
  }

  trackSpacesEvent("invite_accepted");
  await setActiveWorkspace(workspaceId);
  redirect("/");
}
