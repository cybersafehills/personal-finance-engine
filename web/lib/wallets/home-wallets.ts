// The per-wallet cards Home swipes through. PURE (no imports) so it is
// unit-tested with `deno test`.
//
// Each wallet has its own accounting, so Home shows one card per wallet rather
// than adding them together. The default wallet (the workspace's primary
// account) comes first, so it is what you see before you swipe.

export type HomeWalletCard = {
  id: string;
  name: string;
  /** e.g. "MTN Mobile Money · RWF". */
  subtitle: string;
  /** Already formatted for the wallet's own currency; null = no balance yet. */
  amountText: string | null;
  asOfIso: string | null;
  /** How far to trust the figure, in words ("Confirmed", "Estimated", ...). */
  statusLabel: string;
  isDefault: boolean;
};

/** Default first; everyone else keeps their given (already name-sorted) order. */
export function orderForHome<T extends { isDefault: boolean }>(
  cards: readonly T[],
): T[] {
  return [
    ...cards.filter((c) => c.isDefault),
    ...cards.filter((c) => !c.isDefault),
  ];
}
