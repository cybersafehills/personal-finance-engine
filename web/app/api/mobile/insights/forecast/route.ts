import { NextRequest } from "next/server";

import { parseForecastScope, serializeWalletForecast } from "../../../../../lib/intelligence/forecast-api";
import { loadCashFlowForecast } from "../../../../../lib/intelligence/forecast-data";
import { isIntelligenceEnabled } from "../../../../../lib/intelligence/insights";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../lib/mobile-workspace";
import { getActiveWorkspaceId } from "../../../../../lib/queries";

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "insights-forecast", async () => {
    const scope = parseForecastScope(request.nextUrl.searchParams);
    if (!scope) throw new MobileApiError(400, "invalid_forecast_scope");

    const { workspaceId } = await resolveMobileWorkspace(scope.workspaceId);
    if (workspaceId !== await getActiveWorkspaceId() || !isIntelligenceEnabled(workspaceId)) {
      throw new MobileApiError(404, "not_found");
    }
    requireFlag("INSIGHTS_CENTER", workspaceId);

    try {
      const now = new Date();
      const entries = await loadCashFlowForecast(workspaceId, { days: scope.days, accountId: scope.accountId ?? undefined, now });
      return {
        workspace_id: workspaceId,
        account_id: scope.accountId,
        horizon_days: scope.days,
        computed_at: now.toISOString(),
        forecasts: entries.map(serializeWalletForecast),
      };
    } catch (error) {
      if (error instanceof RangeError) throw new MobileApiError(422, "forecast_unavailable");
      throw error;
    }
  });
}
