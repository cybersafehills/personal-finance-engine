// Presentation-only display-name normalization. Never touches stored data -
// transactions.counterparty_name (the raw, evidence-preserving value parsed
// from the SMS) is never modified; this only decides what label to *show*.
// Deterministic mapping, not a generic NLP/cleanup layer - one rule per
// known-messy case, added only when a real one is observed.

import type { TransactionRow } from "./queries";

/**
 * Returns a human-readable display name for a transaction's counterparty.
 * The raw value is always still available via `transaction.counterparty_name`
 * for anyone who needs it (e.g. a future debug view) - this function only
 * decides what the UI shows by default.
 */
export function displayName(transaction: TransactionRow): string {
  const raw = transaction.counterparty_name;

  if (!raw) {
    return transaction.transaction_type === "airtime" ? "MTN Airtime" : "Unknown";
  }

  // MTN's airtime confirmation SMS sometimes renders the counterparty as
  // "Airtime with token and ET Id: ..." rather than a clean merchant name -
  // every airtime transaction means the same thing, so show one consistent
  // label instead of the raw fragment. Matched on the raw name itself, not
  // only transaction_type === "airtime": a pre-existing parser edge case
  // classifies some of these as "merchant_payment" instead, but the raw
  // text is the same tell regardless of how it got classified.
  if (
    transaction.transaction_type === "airtime" ||
    raw.startsWith("Airtime with token")
  ) {
    return "MTN Airtime";
  }

  return raw;
}
