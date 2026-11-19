import { NextRequest } from "next/server";
import { mobileGet, mobileOptions, MobileApiError } from "../../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { parseFeeQuery } from "../../../../../lib/fees/fee-estimate";
import { loadFeeHistory, loadNetworkFees } from "../../../../../lib/fees/fee-data";
import { buildFeeResult, serializeFeeResult } from "../../../../../lib/fees/fee-result";
import { isPaymentNetworksEnabled, isPayServicesEnabled } from "../../../../../lib/pay/gate";

// GET /api/mobile/fees/estimate?amount&currency&type[&network][&workspace_id]
// - what a payment like this has cost the caller before (from their own ledger)
// and, when a network is named, what that network publishes. Estimates, never
// guarantees; a fee with no published number yields no number. Read-only; the
// answer is built by the same lib/fees code as the web page. Dark unless
// FEE_CALCULATOR_ENABLED (+ optional allowlist) covers the workspace.
// See docs/oneledger-3/contracts.md.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "fees-estimate", async () => {
    const q = parseFeeQuery(Object.fromEntries(request.nextUrl.searchParams), "RWF");
    if (q.amountMinor === null) {
      throw new MobileApiError(400, q.amountError ? "invalid_amount" : "amount_required");
    }

    const { workspaceId } = await resolveMobileWorkspace(q.workspaceId);
    requireFlag("FEE_CALCULATOR", workspaceId);
    if (!isPayServicesEnabled(workspaceId)) throw new MobileApiError(404, "not_found");

    const supabase = await supabaseSession();
    const wantNetwork = Boolean(q.network) && isPaymentNetworksEnabled(workspaceId);
    const [history, network] = await Promise.all([
      loadFeeHistory(supabase, workspaceId, q.type, q.currency),
      wantNetwork ? loadNetworkFees(supabase, q.network as string) : Promise.resolve(null),
    ]);
    if (wantNetwork && !network) throw new MobileApiError(404, "network_not_found");

    return {
      workspace_id: workspaceId,
      computed_at: new Date().toISOString(),
      ...serializeFeeResult(
        buildFeeResult({
          amountMinor: q.amountMinor,
          currency: q.currency,
          type: q.type,
          history,
          network,
          now: new Date(),
        }),
      ),
    };
  });
}
