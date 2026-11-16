import type { DrilldownTransaction } from "@/features/insights/types";
import type { SupportedCurrency } from "@/lib/money";

export type PersonKind = "person" | "merchant" | "unknown";
export type PersonConfidence = "user_confirmed" | "high" | "low";

export type PersonCurrency = {
  currency: SupportedCurrency;
  sentMinor: bigint;
  receivedMinor: bigint;
  netMinor: bigint;
  txnCount: number;
};

export type Person = {
  id: string;
  displayName: string;
  kind: PersonKind;
  confidence: PersonConfidence;
  txnCount: number;
  firstAt: string | null;
  lastAt: string | null;
  currencies: PersonCurrency[];
};

export type PersonDetail = {
  person: Person;
  mergedFrom: { id: string; displayName: string }[];
  totalTransactions: number;
  transactions: DrilldownTransaction[];
};
