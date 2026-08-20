import type { ParsedTransaction } from "./types.ts";
import {
  extractBalance,
  extractFee,
  extractTransactionId,
  normalizeMessage,
  parseNumber,
  parseOccurredAt,
} from "./parser-utils.ts";

/**
 * Deterministic MTN Rwanda Mobile Money SMS parser.
 *
 * Pattern order matters: more specific patterns (e.g. airtime) must be
 * checked before generic fallbacks (e.g. the generic merchant/transaction
 * pattern) so that specific transaction types are never swallowed by a
 * broader pattern. See tests/parser_test.ts for a regression test that
 * pins this precedence.
 */
export function parseMomoMessage(
  rawMessage: string,
): ParsedTransaction | null {
  const message = normalizeMessage(rawMessage);

  // =========================================================
  // 1. FAILED TRANSACTION
  // =========================================================

  const failed = message.match(
    /transaction with amount\s+([\d,]+)\s+RWF.*?failed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (failed) {
    return {
      external_transaction_id: extractTransactionId(message),
      transaction_type: "other",
      direction: "out",
      status: "failed",
      amount_rwf: parseNumber(failed[1]) ?? 0,
      fee_rwf: 0,
      balance_after_rwf: extractBalance(message),
      counterparty_name: "MTN RWANDACELL LIMITED",
      counterparty_reference: null,
      occurred_at: parseOccurredAt(failed[2], failed[3]),
      metadata: {
        parser_pattern: "failed_transaction",
      },
    };
  }

  // =========================================================
  // 2. MONEY RECEIVED
  // =========================================================

  const received = message.match(
    /You have received\s+([\d,]+)\s+RWF\s+from\s+(.+?)\s+\(([^)]+)\)\s+at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (received) {
    return {
      external_transaction_id: extractTransactionId(message),
      transaction_type: "money_received",
      direction: "in",
      status: "success",
      amount_rwf: parseNumber(received[1]) ?? 0,
      fee_rwf: 0,
      balance_after_rwf: extractBalance(message),
      counterparty_name: received[2].trim(),
      counterparty_reference: received[3].trim(),
      occurred_at: parseOccurredAt(received[4], received[5]),
      metadata: {
        parser_pattern: "money_received",
      },
    };
  }

  // =========================================================
  // 3. SEND MONEY
  // =========================================================

  const transferred = message.match(
    /([\d,]+)\s+RWF\s+transferred to\s+(.+?)\s+\(([^)]+)\)\s+at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (transferred) {
    return {
      external_transaction_id: extractTransactionId(message),
      transaction_type: "send_money",
      direction: "out",
      status: "success",
      amount_rwf: parseNumber(transferred[1]) ?? 0,
      fee_rwf: extractFee(message),
      balance_after_rwf: extractBalance(message),
      counterparty_name: transferred[2].trim(),
      counterparty_reference: transferred[3].trim(),
      occurred_at: parseOccurredAt(transferred[4], transferred[5]),
      metadata: {
        parser_pattern: "send_money",
      },
    };
  }

  // =========================================================
  // 4. AIRTIME
  //
  // Specific parser must run before the generic merchant parser.
  // Example:
  // Your payment of 100 RWF to Airtime with token ...
  // was completed at ...
  // =========================================================

  const airtimePayment = message.match(
    /Your payment of\s+([\d,]+)\s+RWF\s+to\s+Airtime\b.*?was completed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (airtimePayment) {
    return {
      external_transaction_id: extractTransactionId(message),
      transaction_type: "airtime",
      direction: "out",
      status: "success",
      amount_rwf: parseNumber(airtimePayment[1]) ?? 0,
      fee_rwf: extractFee(message),
      balance_after_rwf: extractBalance(message),
      counterparty_name: "Airtime",
      counterparty_reference: null,
      occurred_at: parseOccurredAt(airtimePayment[2], airtimePayment[3]),
      metadata: {
        parser_pattern: "airtime_payment",
      },
    };
  }

  // =========================================================
  // 5. NORMAL MERCHANT PAYMENT
  //
  // Example:
  // Your payment of 4,000 RWF to KMLVIO CENTER AND MILK
  // ZONE SHOP 093011 was completed at ...
  // =========================================================

  const merchantPayment = message.match(
    /Your payment of\s+([\d,]+)\s+RWF\s+to\s+(.+?)\s+was completed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (merchantPayment) {
    const merchantRaw = merchantPayment[2].trim();

    const referenceMatch = merchantRaw.match(/\s([0-9]{5,})$/);

    const reference = referenceMatch?.[1] ?? null;

    const merchantName = reference
      ? merchantRaw.replace(/\s+[0-9]{5,}$/, "").trim()
      : merchantRaw;

    return {
      external_transaction_id: extractTransactionId(message),
      transaction_type: "merchant_payment",
      direction: "out",
      status: "success",
      amount_rwf: parseNumber(merchantPayment[1]) ?? 0,
      fee_rwf: extractFee(message),
      balance_after_rwf: extractBalance(message),
      counterparty_name: merchantName,
      counterparty_reference: reference,
      occurred_at: parseOccurredAt(merchantPayment[3], merchantPayment[4]),
      metadata: {
        parser_pattern: "merchant_payment",
      },
    };
  }

  // =========================================================
  // 6. GENERIC SUCCESSFUL TRANSACTION
  //
  // Example:
  // A transaction of 11520 RWF by Yego Innovision Ltd
  // was completed at ...
  // =========================================================

  const genericTransaction = message.match(
    /A transaction of\s+([\d,]+)\s+RWF\s+by\s+(.+?)\s+was completed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (genericTransaction) {
    return {
      external_transaction_id: extractTransactionId(message),
      transaction_type: "merchant_payment",
      direction: "out",
      status: "success",
      amount_rwf: parseNumber(genericTransaction[1]) ?? 0,
      fee_rwf: extractFee(message),
      balance_after_rwf: extractBalance(message),
      counterparty_name: genericTransaction[2].trim(),
      counterparty_reference: null,
      occurred_at: parseOccurredAt(
        genericTransaction[3],
        genericTransaction[4],
      ),
      metadata: {
        parser_pattern: "generic_transaction",
      },
    };
  }

  return null;
}
