import { NextRequest } from "next/server";

import { getFinancialInbox } from "../../../../lib/financial-inbox";
import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";

// GET /api/mobile/inbox - the same prioritized Inbox the web renders
// (lib/financial-inbox.ts), for the mobile app (ADR 0019). Auth, MFA, rate
// limiting and the request-scoped session live in lib/mobile-request.ts.
// Read-only.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "inbox", async () => ({
    inbox: await getFinancialInbox(),
  }));
}
