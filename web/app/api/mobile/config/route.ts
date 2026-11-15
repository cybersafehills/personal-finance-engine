import { NextRequest } from "next/server";

import { mobileConfig } from "../../../../lib/mobile-config";
import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { getActiveWorkspaceId } from "../../../../lib/queries";

// GET /api/mobile/config - which optional features are on for the caller, so the
// app only shows a screen or button that will work (ADR 0019). Booleans only.
// Resolved for the user's personal workspace (no session cookie here), the same
// scope as the Inbox and Budgets. Read-only.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "config", async () => ({
    config: mobileConfig(await getActiveWorkspaceId()),
  }));
}
