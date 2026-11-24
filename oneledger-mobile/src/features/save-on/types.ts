// "Save On": a payment sent as several transfers. Each part is an ordinary payment
// the person hands off themselves, one at a time; OneLedger never moves money.
// Money is carried as digit strings (the server's bigint-safe form).

export type SaveOnOffer = {
  /** capacity = the amount is above the network's limit for one transfer (eKash); fee_saving = parts cost less. */
  kind: "capacity" | "fee_saving";
  networkSlug: string | null;
  totalMinor: string;
  parts: { index: number; amountMinor: string; feeMinor: string | null }[];
  singleFeeMinor: string | null;
  plannedFeeMinor: string | null;
  savingsMinor: string | null;
  /** verified_tariff = exact, from the provider's published table; published_maximum = a ceiling, not a prediction. */
  feeBasis: "verified_tariff" | "published_maximum" | "none";
  capacityMinor: string | null;
  source: { label: string; url: string | null; asOf: string | null } | null;
};

export type SaveOnNext =
  | { status: "ready" | "waiting" | "blocked"; index: number; amountMinor: string }
  | { status: "complete" | "stopped" };

export type SaveOnPlan = {
  id: string;
  kind: "capacity" | "fee_saving";
  totalMinor: string;
  plannedPartsMinor: string[];
  feeBasis: "verified_tariff" | "published_maximum" | "none";
  stopped: boolean;
  parts: { index: number; intentId: string; amountMinor: string; state: string }[];
  next: SaveOnNext;
  remainingMinor: string;
};

export type SaveOnThreshold = "any" | "balanced" | "bigger";
export type SaveOnPrefs = { feeSavingEnabled: boolean; threshold: SaveOnThreshold };
