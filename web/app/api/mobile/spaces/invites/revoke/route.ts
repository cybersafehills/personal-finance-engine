import { NextRequest } from "next/server";

import { parseRevokeInvite } from "../../../../../../lib/mobile-spaces";
import { requireSpaceAccess } from "../../../../../../lib/mobile-spaces-server";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { logSpacesError } from "../../../../../../lib/spaces/monitoring";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";

// POST /api/mobile/spaces/invites/revoke - cancel a pending invite. The invite
// RLS update policy (a manager of that Space) is the authority; the invite must
// belong to the Space the caller named and still be pending.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "spaces-invite-revoke", async (body, { userId }) => {
    const parsed = parseRevokeInvite(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { workspaceId, inviteId } = parsed.value;

    const supabase = await supabaseSession();
    await requireSpaceAccess(supabase, workspaceId, userId);

    const { data, error } = await supabase
      .from("workspace_invites")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .select("id");
    if (error) {
      logSpacesError("invite", error);
      throw new MobileApiError(403, "could_not_revoke", "You can't cancel invites in this Space.");
    }
    if (!data || data.length === 0) {
      throw new MobileApiError(404, "not_found", "That invite isn't pending any more.");
    }
    return {};
  });
}
