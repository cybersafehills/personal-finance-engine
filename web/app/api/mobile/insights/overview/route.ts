import { NextRequest } from "next/server";
import { mobileGet, mobileOptions, MobileApiError } from "../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../lib/mobile-workspace";
import { fetchInsightFacts, MAX_FACT_ROWS } from "../../../../../lib/insights/insights-data";
import {
  compare,
  computeOverview,
  computeTrend,
  type Comparison,
  type TrendBucket,
} from "../../../../../lib/insights/insights-math";
import {
  parseOverviewParams,
  previousScope,
  serializeOverview,
} from "../../../../../lib/insights/insights-api";

// GET /api/mobile/insights/overview - money in/out/net, categories, accounts,
// top counterparties, optional trend and previous-period comparison, per
// currency (never mixed). Read-only; every figure comes from the shared
// Insights core (lib/insights). Dark unless INSIGHTS_CENTER_ENABLED (+ optional
// allowlist) covers the workspace. See docs/oneledger-3/contracts.md.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "insights-overview", async () => {
    const parsed = parseOverviewParams(request.nextUrl.searchParams);
    if (!parsed.ok) throw new MobileApiError(400, parsed.error);
    const p = parsed.value;

    const { workspaceId } = await resolveMobileWorkspace(p.workspaceId);
    requireFlag("INSIGHTS_CENTER", workspaceId);

    // One fetch covers the current and (if asked) the previous period.
    const prev = p.compare ? previousScope(p.scope) : null;
    const { facts, linked, truncated } = await fetchInsightFacts(
      workspaceId,
      prev ? prev.from : p.scope.from,
      p.scope.to,
    );
    if (truncated) throw new MobileApiError(422, "range_too_large");

    const overview = computeOverview(facts, p.scope, linked);
    const previous = prev ? computeOverview(facts, prev, linked) : null;

    const extras: Record<string, { compare?: Record<string, Comparison>; trend?: TrendBucket[] }> = {};
    for (const c of overview.currencies) {
      const e: { compare?: Record<string, Comparison>; trend?: TrendBucket[] } = {};
      if (previous) {
        const pc = previous.currencies.find((x) => x.currency === c.currency);
        e.compare = {
          money_in: compare(c.moneyInMinor, pc ? pc.moneyInMinor : null),
          money_out: compare(c.moneyOutMinor, pc ? pc.moneyOutMinor : null),
          net: compare(c.netMinor, pc ? pc.netMinor : null),
        };
      }
      if (p.granularity) {
        e.trend = computeTrend(facts, p.scope, c.currency, linked, p.granularity, p.tz);
      }
      extras[c.currency] = e;
    }

    return {
      workspace_id: workspaceId,
      overview: serializeOverview(overview, p.tz, extras),
      limits: { max_rows: MAX_FACT_ROWS },
    };
  });
}
