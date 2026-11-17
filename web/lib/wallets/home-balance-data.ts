import "server-only";
import { cache } from "react";
import { getActiveWorkspaceId, getCurrentBalance } from "../queries";
import { supabaseSession } from "../supabase-session-server";
import { isOneLedger3FlagEnabled } from "../oneledger3-flags";
import { combineHomeBalance, type HomeBalance } from "./home-balance";
import { loadWallets } from "./wallets-data";

// The balance Home and the cash-flow forecast both start from. With the
// balance-provenance flag on it is built from the per-wallet figures (the same
// ones the Wallets page shows); otherwise, or if that read fails or finds no
// number, it falls back to the old "newest transaction's balance" so Home never
// goes blank because of this.
//
// cache(): Home and the forecast (layout + page) share one read per request.
export const getHomeBalance: () => Promise<HomeBalance | null> = cache(async () => {
  const workspaceId = await getActiveWorkspaceId();
  if (workspaceId && isOneLedger3FlagEnabled(process.env, "BALANCE_PROVENANCE", workspaceId)) {
    try {
      const wallets = await loadWallets(await supabaseSession(), workspaceId);
      const combined = combineHomeBalance(
        wallets.map((w) => ({
          name: w.name,
          currency: w.currency,
          amountMinor: w.balance.amountMinor,
          asOf: w.balance.asOf,
          basis: w.balance.basis,
        })),
      );
      if (combined) return combined;
    } catch (e) {
      console.error("getHomeBalance wallets failed:", e instanceof Error ? e.message : "unknown");
    }
  }
  const legacy = await getCurrentBalance();
  return legacy
    ? {
      amountRwf: legacy.amountRwf,
      asOfIso: legacy.asOfIso,
      label: "MTN Mobile Money",
      walletCount: 1,
      excludedCount: 0,
    }
    : null;
});
