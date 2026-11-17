// What Home's "Current balance" shows when more than one wallet exists.
// PURE (no imports) so it is unit-tested with `deno test`.
//
// The old Home figure was "the balance on the newest transaction of ANY
// wallet", labelled with a hard-coded "MTN Mobile Money". With two wallets
// that is whichever one messaged last, under the wrong name. This combines
// the per-wallet figures the Wallets page already shows, never across
// currencies, and says how many wallets it adds up and how old the oldest
// figure is.

export type HomeWallet = {
  name: string;
  currency: string;
  /** null = this wallet has no balance at all (it is not counted). */
  amountMinor: bigint | null;
  /** When the figure is true as of (not "now"). */
  asOf: string | null;
  /** Where the figure came from. Only a provider's own message counts on Home. */
  basis: "provider_reported" | "manual" | null;
};

export type HomeBalance = {
  amountRwf: number;
  /** The OLDEST as-of among the counted wallets, so the age is never flattered. */
  asOfIso: string | null;
  /** Under the amount: the wallet's name, or "All N wallets". */
  label: string;
  walletCount: number;
  /** RWF wallets left out: no balance, or a balance you typed in (those stay on Wallets). */
  excludedCount: number;
};

/** null when no RWF wallet has a number - the caller then keeps its old behaviour. */
export function combineHomeBalance(wallets: readonly HomeWallet[]): HomeBalance | null {
  const rwf = wallets.filter((w) => w.currency === "RWF");
  // Home has always shown what the provider reported. A balance someone typed
  // in is a statement, not a reading, so it is shown on Wallets and left out of
  // this total (and said so), never silently added.
  const counted = rwf.filter((w) => w.amountMinor !== null && w.basis === "provider_reported");
  if (counted.length === 0) return null;

  const total = counted.reduce((sum, w) => sum + (w.amountMinor as bigint), 0n);
  // Every wallet has a figure within reach of Number for RWF; guard anyway.
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  let oldest: string | null = null;
  for (const w of counted) {
    if (w.asOf && (oldest === null || Date.parse(w.asOf) < Date.parse(oldest))) oldest = w.asOf;
  }
  return {
    amountRwf: Number(total),
    asOfIso: oldest,
    label: counted.length === 1 ? counted[0].name : `All ${counted.length} wallets`,
    walletCount: counted.length,
    excludedCount: rwf.length - counted.length,
  };
}
