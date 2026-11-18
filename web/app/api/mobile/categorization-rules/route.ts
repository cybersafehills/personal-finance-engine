import { NextRequest } from "next/server";

import { getMobileRules } from "../../../../lib/categorization/mobile-queries";
import { toMobileRule } from "../../../../lib/mobile-rules";
import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { getActiveWorkspaceId } from "../../../../lib/queries";

// GET /api/mobile/categorization-rules - the rules that automatically categorize
// transactions in the Space the app is viewing, in the order they are checked
// (the web's Categorization rules page), for the mobile app (ADR 0019).
// Read-only here; pausing and resuming is POST .../active. A failed read throws,
// so the answer is a retryable error, never an empty list.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "categorization-rules", async () => {
    const workspaceId = await getActiveWorkspaceId();
    if (!workspaceId) return { rules: [] };
    return { rules: (await getMobileRules(workspaceId)).map(toMobileRule) };
  });
}
