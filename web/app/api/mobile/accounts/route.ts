import { NextRequest } from "next/server";
import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { loadWallets } from "../../../../lib/wallets/wallets-data";

// GET /api/mobile/accounts - the workspace's active accounts with an honest
// balance label (Confirmed / Estimated / Stale / Unavailable), derived from
// provider-reported balances and the user's own statements - never a fabricated
// number. Read-only. Dark unless BALANCE_PROVENANCE_ENABLED covers the workspace.
// (Recording a balance is the record_manual_balance_observation RPC, called by
// the app directly under RLS - see docs/mobile-api.md.)
// The rows come from lib/wallets/wallets-data.ts, the same loader the web
// Wallets page uses, so the two can never label a balance differently.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "accounts", async () => {
    const { workspaceId } = await resolveMobileWorkspace(
      request.nextUrl.searchParams.get("workspace_id"),
    );
    requireFlag("BALANCE_PROVENANCE", workspaceId);

    const wallets = await loadWallets(await supabaseSession(), workspaceId);
    return {
      workspace_id: workspaceId,
      accounts: wallets.map((w) => ({
        id: w.id,
        name: w.name,
        provider: w.provider,
        currency: w.currency,
        is_primary: w.isPrimary,
        latest_txn_at: w.latestTxnAt,
        balance: {
          status: w.balance.status,
          amount_minor: w.balance.amountMinor === null
            ? null
            : w.balance.amountMinor.toString(),
          as_of: w.balance.asOf,
          basis: w.balance.basis,
          reasons: w.balance.reasons,
        },
      })),
    };
  });
}
