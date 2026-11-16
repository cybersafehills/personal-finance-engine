import type { SupportedCurrency } from "@/lib/money";

export type RequestStatus = "open" | "expired" | "cancelled" | "marked_paid_by_owner" | "matched";

export type PaymentRequest = {
  id: string;
  workspaceId: string;
  amountMinor: bigint;
  currency: SupportedCurrency;
  destinationType: "momo_phone" | "merchant_code";
  destinationValue: string;
  recipientDisplay: string;
  reference: string | null;
  expiresAt: string;
  /** Effective status: 'expired' is derived by the database view. */
  status: RequestStatus;
  matchedTransactionId: string | null;
  createdAt: string;
};

export type MatchCandidate = { id: string; occurredAt: string; counterpartyName: string | null };
