import { NextRequest } from "next/server";
import { mobileGet, mobileOptions, MobileApiError } from "../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../lib/mobile-workspace";
import { fetchInsightFacts } from "../../../../../lib/insights/insights-data";
import { applyDrilldown } from "../../../../../lib/insights/insights-math";
import { parseDrilldownParams, serializeFact } from "../../../../../lib/insights/insights-api";

// GET /api/mobile/insights/drilldown - the transactions behind one aggregate.
// Takes the same filter an overview aggregate returned (kind/value/currency +
// the period), runs it through the SAME classification the totals use, so the
// rows always add up to the number that was tapped. Paged (limit<=100).

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "insights-drilldown", async () => {
    const parsed = parseDrilldownParams(request.nextUrl.searchParams);
    if (!parsed.ok) throw new MobileApiError(400, parsed.error);
    const { filter, workspaceId: requested, limit, offset } = parsed.value;

    const { workspaceId } = await resolveMobileWorkspace(requested);
    requireFlag("INSIGHTS_CENTER", workspaceId);

    const { facts, linked, truncated } = await fetchInsightFacts(
      workspaceId,
      filter.scope.from,
      filter.scope.to,
    );
    if (truncated) throw new MobileApiError(422, "range_too_large");

    const rows = applyDrilldown(facts, filter, linked); // already newest-first
    return {
      total: rows.length,
      limit,
      offset,
      transactions: rows.slice(offset, offset + limit).map(serializeFact),
    };
  });
}
