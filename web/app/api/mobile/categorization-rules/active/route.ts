import { NextRequest } from "next/server";

import { parseSetActive, toMobileRule } from "../../../../../lib/mobile-rules";
import { getMobileRules } from "../../../../../lib/categorization/mobile-queries";
import { requireSpaceAccess } from "../../../../../lib/mobile-spaces-server";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../lib/mobile-request";
import { supabaseSession } from "../../../../../lib/supabase-session-server";

// POST /api/mobile/categorization-rules/active - pause or resume one rule.
// Same change as the web's setPolicyActive (there is no delete; pausing is how a
// rule is retired). The Space is named explicitly and never defaults to Personal.
// RLS lets only a member or above update a rule, and an UPDATE that RLS hides
// returns no error and no rows, so the changed row is read back: a viewer gets a
// clear 403 instead of a silent "success".

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "categorization-rules-active", async (body, { userId }) => {
    const parsed = parseSetActive(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const { workspaceId, ruleId, active } = parsed.value;

    const supabase = await supabaseSession();
    const access = await requireSpaceAccess(supabase, workspaceId, userId);
    if (access.role === "viewer") {
      throw new MobileApiError(403, "forbidden", "You can view rules in this Space but not change them.");
    }

    const { data, error } = await supabase
      .from("categorization_policies")
      .update({ is_active: active })
      .eq("id", ruleId)
      .eq("workspace_id", workspaceId)
      .select("id");
    if (error) throw new Error(`rule update failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new MobileApiError(404, "not_found", "That rule wasn't found in this Space.");
    }

    // Answer with the rule as it is now, so the app never guesses.
    const rule = (await getMobileRules(workspaceId)).find((r) => r.id === ruleId);
    if (!rule) throw new MobileApiError(404, "not_found", "That rule wasn't found in this Space.");
    return { rule: toMobileRule(rule) };
  });
}
