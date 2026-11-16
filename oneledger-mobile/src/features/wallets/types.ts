export type BalanceStatus = "confirmed" | "estimated" | "stale" | "unavailable";
export type BalanceReason =
  | "no_baseline"
  | "baseline_old"
  | "unresolved_activity"
  | "reconciliation_mismatch"
  | "user_stated_baseline"
  | "activity_since_baseline";

export type WalletBalance = {
  status: BalanceStatus;
  /** null only when status is "unavailable" - no number is ever invented. */
  amountMinor: bigint | null;
  /** When the figure is true as of (the baseline time), not "now". */
  asOf: string | null;
  basis: "provider_reported" | "manual" | null;
  reasons: BalanceReason[];
};

export type Wallet = {
  id: string;
  name: string;
  provider: string;
  currency: "RWF" | "EUR" | "USD";
  isPrimary: boolean;
  latestTxnAt: string | null;
  balance: WalletBalance;
};
