import type { Wallet } from "@/features/wallets/types";

/** Only an existing wallet can become the landing card; currencies stay separate. */
export function landingWallets(wallets: readonly Wallet[], preferredId: string | null): Wallet[] {
  return [...wallets].sort((a,b) => Number(b.id === preferredId) - Number(a.id === preferredId) || Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export const landingWalletKey = (scope: string) => `ol.home.wallet.v1.${scope}`;
