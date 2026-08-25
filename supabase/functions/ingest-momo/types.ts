export type TransactionType =
  | "send_money"
  | "merchant_payment"
  | "money_received"
  | "airtime"
  | "cash_withdrawal"
  | "cash_deposit"
  | "bill_payment"
  | "bank_transfer"
  | "refund"
  | "reversal"
  | "other";

export type TransactionDirection = "in" | "out" | "neutral";

export type TransactionStatus =
  | "success"
  | "failed"
  | "reversed"
  | "pending"
  | "unknown";

export type ParsedTransaction = {
  external_transaction_id: string | null;
  transaction_type: TransactionType;
  direction: TransactionDirection;
  status: TransactionStatus;
  amount_rwf: number;
  fee_rwf: number;
  balance_after_rwf: number | null;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

export type PolicyClassification = {
  normalizedMerchantName: string | null;
  category: string | null;
  subcategory: string | null;
  categorySource: string | null;
  categoryConfidence: number | null;
  matchedPolicyId: string | null;
  explanation: string | null;
};

export type CategorizationPolicyRow = {
  id: string;
  name: string | null;
  priority: number;
  match_type: "exact" | "contains" | "starts_with" | "regex" | string;
  merchant_pattern: string | null;
  normalized_merchant_name: string | null;
  category: string | null;
  subcategory: string | null;
  confidence: number | null;
  usage_count: number | null;
  direction: TransactionDirection | null;
  amount_min_rwf: number | null;
  amount_max_rwf: number | null;
  time_start: string | null;
  time_end: string | null;
};
