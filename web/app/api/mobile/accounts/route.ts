import { NextRequest } from "next/server";
import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { deriveBalance, type BalanceBaselineRow } from "../../../../lib/balance-status";

// GET /api/mobile/accounts - the workspace's active accounts with an honest
// balance label (Confirmed / Estimated / Stale / Unavailable), derived from
// provider-reported balances and the user's own statements - never a fabricated
// number. Read-only. Dark unless BALANCE_PROVENANCE_ENABLED covers the workspace.
// (Recording a balance is the record_manual_balance_observation RPC, called by
// the app directly under RLS - see docs/mobile-api.md.)

export const OPTIONS = mobileOptions;

type AccountRow = {
  id: string;
  name: string;
  provider: string;
  currency: string;
  is_primary: boolean;
};
type BaselineRow = BalanceBaselineRow & { account_id: string; latest_txn_at: string | null };

export function GET(request: NextRequest) {
  return mobileGet(request, "accounts", async () => {
    const { workspaceId } = await resolveMobileWorkspace(
      request.nextUrl.searchParams.get("workspace_id"),
    );
    requireFlag("BALANCE_PROVENANCE", workspaceId);

    const supabase = await supabaseSession();
    const [accounts, baselines] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, provider, currency, is_primary")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .order("is_primary", { ascending: false })
        .order("name"),
      supabase.from("account_balance_baselines_v").select("*").eq("workspace_id", workspaceId),
    ]);
    if (accounts.error || baselines.error) throw new Error("accounts query failed");

    const byAccount = new Map(((baselines.data ?? []) as BaselineRow[]).map((b) => [b.account_id, b]));
    const now = new Date();
    return {
      workspace_id: workspaceId,
      accounts: ((accounts.data ?? []) as AccountRow[]).map((a) => {
        const b = byAccount.get(a.id);
        const d = deriveBalance(
          b ?? {
            baseline_amount_minor: null,
            baseline_as_of: null,
            baseline_source: null,
            txns_since_count: 0,
            net_effect_since_minor: 0,
            unresolved_since_count: 0,
            mismatch_since_count: 0,
          },
          now,
        );
        return {
          id: a.id,
          name: a.name,
          provider: a.provider,
          currency: a.currency,
          is_primary: a.is_primary,
          latest_txn_at: b?.latest_txn_at ?? null,
          balance: {
            status: d.status,
            amount_minor: d.amountMinor === null ? null : d.amountMinor.toString(),
            as_of: d.asOf,
            basis: d.basis,
            reasons: d.reasons,
          },
        };
      }),
    };
  });
}
