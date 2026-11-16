import { NextRequest } from "next/server";

import { mapMemberRpcError, parseRemove } from "../../../../../../lib/mobile-spaces";
import { requireSpaceAccess } from "../../../../../../lib/mobile-spaces-server";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { trackSpacesEvent } from "../../../../../../lib/spaces/analytics";
import { logSpacesError } from "../../../../../../lib/spaces/monitoring";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";

// POST /api/mobile/spaces/members/remove - remove a member from a Space. Same
// guard and reasoning as .../members/role; remove_member is the authority
// (owners only, never the last owner).

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "spaces-member-remove", async (body, { userId }) => {
    const parsed = parseRemove(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { workspaceId, membershipId } = parsed.value;

    const supabase = await supabaseSession();
    const access = await requireSpaceAccess(supabase, workspaceId, userId);
    if (access.kind === "personal") {
      throw new MobileApiError(422, "personal_space", "A personal Space has no other members.");
    }

    const { data: target } = await supabase
      .from("workspace_memberships")
      .select("id")
      .eq("id", membershipId)
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .maybeSingle();
    if (!target) throw new MobileApiError(404, "not_found", "That member isn't in this Space any more.");

    const { error } = await supabase.rpc("remove_member", { p_membership_id: membershipId });
    if (error) {
      logSpacesError("member_manage", error);
      const failure = mapMemberRpcError(error.message);
      throw new MobileApiError(failure.status, failure.code, failure.message);
    }

    trackSpacesEvent("member_removed");
    return {};
  });
}
