import "server-only";
import { cache } from "react";
import { getActiveWorkspaceId, getCurrentBalance } from "../queries";
import { supabaseSession } from "../supabase-session-server";
import { isOneLedger3FlagEnabled } from "../oneledger3-flags";
import { combineHomeBalance, type HomeBalance } from "./home-balance";
import { formatMoney } from "../insights/insights-facts";
import { type HomeWalletCard, orderForHome } from "./home-wallets";
import {
  loadWallets,
  loadWalletSpaces,
  type WalletSpaces,
} from "./wallets-data";
import { PROVIDER_LABEL, STATUS_LABEL } from "./wallets-display";

// The balance Home and the cash-flow forecast both start from. With the
// balance-provenance flag on it is built from the per-wallet figures (the same
// ones the Wallets page shows); otherwise, or if that read fails or finds no
// number, it falls back to the old "newest transaction's balance" so Home never
// goes blank because of this.
//
// cache(): Home and the forecast (layout + page) share one read per request.
export const getHomeBalance: () => Promise<HomeBalance | null> = cache(
  async () => {
    const workspaceId = await getActiveWorkspaceId();
    if (
      workspaceId &&
      isOneLedger3FlagEnabled(process.env, "BALANCE_PROVENANCE", workspaceId)
    ) {
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
        console.error(
          "getHomeBalance wallets failed:",
          e instanceof Error ? e.message : "unknown",
        );
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
  },
);

// One card per wallet for Home's swipeable balances (BALANCE_PROVENANCE on).
// null = flag off, read failed, or no wallets: Home then keeps the single card.
export const getHomeWalletCards: () => Promise<HomeWalletCard[] | null> = cache(
  async () => {
    const workspaceId = await getActiveWorkspaceId();
    if (
      !workspaceId ||
      !isOneLedger3FlagEnabled(process.env, "BALANCE_PROVENANCE", workspaceId)
    ) {
      return null;
    }
    try {
      const wallets = await loadWallets(await supabaseSession(), workspaceId);
      if (wallets.length === 0) return null;
      return orderForHome(wallets.map((w): HomeWalletCard => ({
        id: w.id,
        name: w.name,
        subtitle: `${PROVIDER_LABEL[w.provider] ?? "Other"} · ${w.currency}`,
        amountText: w.balance.amountMinor === null
          ? null
          : formatMoney(w.balance.amountMinor, w.currency),
        asOfIso: w.balance.asOf,
        statusLabel: STATUS_LABEL[w.balance.status],
        isDefault: w.isPrimary,
      })));
    } catch (e) {
      console.error(
        "getHomeWalletCards failed:",
        e instanceof Error ? e.message : "unknown",
      );
      return null;
    }
  },
);

/**
 * Set when the active Space has no wallets but another Space you belong to does:
 * Home then says where they are and offers the switch, instead of quietly
 * showing a different Space's numbers. null = nothing to say.
 */
export const getHomeSpaceNotice: () => Promise<WalletSpaces | null> = cache(
  async () => {
    const workspaceId = await getActiveWorkspaceId();
    if (
      !workspaceId ||
      !isOneLedger3FlagEnabled(process.env, "BALANCE_PROVENANCE", workspaceId)
    ) {
      return null;
    }
    try {
      const supabase = await supabaseSession();
      if ((await loadWallets(supabase, workspaceId)).length > 0) return null;
      const spaces = await loadWalletSpaces(supabase, workspaceId);
      return spaces.others.length > 0 ? spaces : null;
    } catch (e) {
      console.error(
        "getHomeSpaceNotice failed:",
        e instanceof Error ? e.message : "unknown",
      );
      return null;
    }
  },
);
