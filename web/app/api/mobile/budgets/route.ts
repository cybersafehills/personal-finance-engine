import { NextRequest } from "next/server";

import { getBudgetActuals, getBudgetById, getBudgets } from "../../../../lib/queries";
import { toMobileBudget, type MobileBudget } from "../../../../lib/mobile-budgets";
import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";

// GET /api/mobile/budgets - the active budgets with their actuals, for the
// mobile app (ADR 0019). The figures come from getBudgetActuals, the single
// canonical aggregation (never reimplemented client-side); this only reshapes
// them into JSON. Read-only.

export const OPTIONS = mobileOptions;

// A household rarely has more than one active budget; cap the work anyway.
const MAX_BUDGETS = 3;

export function GET(request: NextRequest) {
  return mobileGet(request, "budgets", async () => {
    const active = (await getBudgets())
      .filter((b) => b.status === "active")
      .slice(0, MAX_BUDGETS);

    const budgets: MobileBudget[] = [];
    for (const row of active) {
      const full = await getBudgetById(row.id);
      if (!full) continue;
      const mobile = toMobileBudget(full, await getBudgetActuals(full));
      if (mobile) budgets.push(mobile);
    }
    return { budgets };
  });
}
