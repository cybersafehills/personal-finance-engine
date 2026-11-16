import { NextRequest } from "next/server";

import { getUserForRequest } from "../../../../../lib/mobile-api";
import { parseCreateInvite } from "../../../../../lib/mobile-spaces";
import { requireSpaceAccess } from "../../../../../lib/mobile-spaces-server";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../lib/mobile-request";
import { createWorkspaceInvite } from "../../../../../lib/spaces/invites";
import { supabaseSession } from "../../../../../lib/supabase-session-server";

// POST /api/mobile/spaces/invites - invite someone to a Space by email.
// Shares lib/spaces/invites.ts with the web action: the token is generated
// there, only its hash is stored, and the link is returned ONCE here (the app
// shows it for the inviter to copy; it is never stored or logged). The invite
// RLS policy (a manager of that Space, invited_by = the caller) is the
// authority; this route adds the second-factor guard, an explicit Space, and
// that a personal Space cannot have invitees.

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "spaces-invite", async (body, { userId, token }) => {
    const parsed = parseCreateInvite(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { workspaceId, email, role } = parsed.value;

    const supabase = await supabaseSession();
    const access = await requireSpaceAccess(supabase, workspaceId, userId);
    if (access.kind === "personal") {
      throw new MobileApiError(422, "personal_space", "Create a household or organization to invite people.");
    }

    // The bearer client has no stored session, so read the user with the token.
    const { data } = await getUserForRequest(supabase.auth, token);

    const created = await createWorkspaceInvite({
      supabase,
      workspaceId,
      userId,
      userEmail: data.user?.email ?? null,
      email,
      role,
    });
    if (!created.ok) {
      throw new MobileApiError(403, "could_not_invite", "You can't invite people to this Space.");
    }
    return { link: created.link, emailSent: created.emailSent };
  });
}
