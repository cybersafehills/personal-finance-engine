import { NextRequest } from "next/server";

import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { getCategoryTotalsComplete } from "../../../../lib/queries";

// GET /api/mobile/categories - where the money has gone, all time, per category
// (the web's Categories page), for the mobile app (ADR 0019). The figures come
// from getCategoryTotalsComplete, the one canonical aggregation (never redone in
// the app); this only serves them. Read-only. Like the web page it covers every
// Space the user belongs to (no Space filter), and `truncated` says so when a
// very long history hit the safety cap, so the app can say the totals are
// incomplete instead of presenting them as whole.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "categories", async () => {
    const { totals, truncated } = await getCategoryTotalsComplete();
    return { categories: totals, truncated };
  });
}
