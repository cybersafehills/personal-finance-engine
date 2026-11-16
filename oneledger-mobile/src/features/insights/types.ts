import type { SupportedCurrency } from "@/lib/money";

// Shapes of the Insights API (GET /api/mobile/insights/*, docs/mobile-api.md).
// Amounts arrive as decimal STRINGS (integer minor units) and are held as
// bigint here: never a float.

export type DrilldownKind =
  | "money_in"
  | "money_out"
  | "category"
  | "counterparty_sent"
  | "counterparty_received"
  | "account"
  | "transfers"
  | "pending"
  | "cash_out"
  | "refunds";

export type Drilldown = {
  kind: DrilldownKind;
  value: string | null;
  currency: string;
  from: string;
  to: string;
  accountIds: string[] | null;
};

export type CategoryRow = {
  category: string;
  amountMinor: bigint;
  count: number;
  /** Basis points of money out (7654 = 76.54%). */
  percentBps: number;
  drilldown: Drilldown;
};

export type PersonRow = {
  key: string;
  displayName: string;
  sentMinor: bigint;
  receivedMinor: bigint;
  count: number;
};

export type Comparison = {
  currentMinor: bigint;
  /** null = there was no earlier period to compare with (never a fabricated 0). */
  previousMinor: bigint | null;
  deltaMinor: bigint | null;
  deltaBps: number | null;
};

export type CurrencyOverview = {
  currency: SupportedCurrency;
  moneyInMinor: bigint;
  moneyOutMinor: bigint;
  netMinor: bigint;
  cashOutMinor: bigint;
  countIn: number;
  countOut: number;
  transfersExcluded: { amountMinor: bigint; count: number };
  pending: { amountMinor: bigint; count: number };
  byCategory: CategoryRow[];
  topPeople: PersonRow[];
  compare: { moneyIn: Comparison; moneyOut: Comparison; net: Comparison } | null;
  drilldowns: { moneyIn: Drilldown; moneyOut: Drilldown; transfers: Drilldown; pending: Drilldown };
};

export type InsightsOverview = {
  from: string;
  to: string;
  latestTxnAt: string | null;
  currencies: CurrencyOverview[];
  /** Currencies the app can't format (shown as a note, never silently dropped). */
  skippedCurrencies: number;
};

export type DrilldownTransaction = {
  id: string;
  direction: "in" | "out" | "neutral";
  transactionType: string;
  amountMinor: bigint;
  currency: SupportedCurrency;
  category: string | null;
  counterpartyName: string | null;
  status: string;
  occurredAt: string;
};
