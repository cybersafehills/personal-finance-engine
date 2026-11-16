import { NextRequest } from "next/server";

import { mapMemberRpcError, parseSetRole } from "../../../../../../lib/mobile-spaces";
import { requireSpaceAccess } from "../../../../../../lib/mobile-spaces-server";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { trackSpacesEvent } from "../../../../../../lib/spaces/analytics";
import { logSpacesError } from "../../../../../../lib/spaces/monitoring";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";

// POST /api/mobile/spaces/members/role - change a member's role.
// The web guards this with a second-factor step-up in the server action, not
// in the database, so the app reaches it only through here: the bearer guard
// (flag, rate limit, token validated, second factor complete = that step-up).
// The set_member_role function is the authority on who may do it (owners only,
// never leaving a Space without an owner); this route adds that the member
// belongs to the Space the caller named, and answers with fixed sentences.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "spaces-member-role", async (body, { userId }) => {
    const parsed = parseSetRole(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { workspaceId, membershipId, role } = parsed.value;

    const supabase = await supabaseSession();
    const access = await requireSpaceAccess(supabase, workspaceId, userId);
    if (access.kind === "personal") {
      throw new MobileApiError(422, "personal_space", "A personal Space has no other members.");
    }

    // The function takes only a membership id; make sure it is in this Space.
    const { data: target } = await supabase
      .from("workspace_memberships")
      .select("id")
      .eq("id", membershipId)
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .maybeSingle();
    if (!target) throw new MobileApiError(404, "not_found", "That member isn't in this Space any more.");

    const { error } = await supabase.rpc("set_member_role", {
      p_membership_id: membershipId,
      p_role: role,
    });
    if (error) {
      logSpacesError("member_manage", error);
      const failure = mapMemberRpcError(error.message);
      throw new MobileApiError(failure.status, failure.code, failure.message);
    }

    trackSpacesEvent("member_role_changed", { role });
    return {};
  });
}
