// Realistic MTN Rwanda Mobile Money SMS fixtures used by parser_test.ts.
//
// Each fixture's `raw` text mirrors an actual MTN Rwanda SMS structure.
// `expected` lists the fields the parser is required to produce.
//
// COVERAGE GAP NOTE: cash_withdrawal, cash_deposit, bill_payment,
// bank_transfer, refund, and reversal are declared in TransactionType but
// have no fixtures or parser support here. No confirmed real-world MTN
// Rwanda SMS sample for these formats was available when this suite was
// written, and the task instructions explicitly forbid inventing
// unverified message formats. See README.md "Unsupported formats" for the
// full list and rationale. Do not add speculative fixtures for these
// without a real production sample to anchor them.

export const airtimeMessage = {
  raw:
    "*162*TxId:29959252916*S*Your payment of 50 RWF to Airtime with token and ET Id: 29959252916 was completed at 2026-08-18 19:42:11. Fee 0 RWF. Balance: 2305 RWF . Message: - -. *RW#",
  expected: {
    external_transaction_id: "29959252916",
    transaction_type: "airtime",
    direction: "out",
    status: "success",
    amount_rwf: 50,
    fee_rwf: 0,
    balance_after_rwf: 2305,
    counterparty_name: "Airtime",
    counterparty_reference: null,
    occurred_at: "2026-08-18T19:42:11+02:00",
    parser_pattern: "airtime_payment",
  },
};

export const merchantPaymentMessage = {
  raw:
    "TxId:29946098339*S*Your payment of 4,000 RWF to KMLVIO CENTER AND MILK ZONE SHOP 093011 was completed at 2026-08-18 11:02:56. Balance: 3,675 RWF. Fee 0 RWF.*EN#",
  expected: {
    external_transaction_id: "29946098339",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 4000,
    fee_rwf: 0,
    balance_after_rwf: 3675,
    counterparty_name: "KMLVIO CENTER AND MILK ZONE SHOP",
    counterparty_reference: "093011",
    occurred_at: "2026-08-18T11:02:56+02:00",
    parser_pattern: "merchant_payment",
  },
};

export const sendMoneyMessage = {
  raw:
    "*165*S*1000 RWF transferred to Samuel NSHIMIYIMANA (250793000439) at 2026-08-18 10:20:09 .Fee: 20RWF.Balance: 175RWF.Dial *182*1*3# and send money abroad *RW#",
  expected: {
    external_transaction_id: null,
    transaction_type: "send_money",
    direction: "out",
    status: "success",
    amount_rwf: 1000,
    fee_rwf: 20,
    balance_after_rwf: 175,
    counterparty_name: "Samuel NSHIMIYIMANA",
    counterparty_reference: "250793000439",
    occurred_at: "2026-08-18T10:20:09+02:00",
    parser_pattern: "send_money",
  },
};

export const moneyReceivedMessage = {
  raw:
    "You have received 7500 RWF from Ogabor JULIUS INEJI (*********901) at 2026-08-18 10:37:10 . Balance:7675 RWF. FT Id: 29945559123",
  expected: {
    external_transaction_id: "29945559123",
    transaction_type: "money_received",
    direction: "in",
    status: "success",
    amount_rwf: 7500,
    fee_rwf: 0,
    balance_after_rwf: 7675,
    counterparty_name: "Ogabor JULIUS INEJI",
    counterparty_reference: "*********901",
    occurred_at: "2026-08-18T10:37:10+02:00",
    parser_pattern: "money_received",
  },
};

export const genericMerchantMessage = {
  raw:
    "*164*S*Y'ello, A transaction of 11520 RWF by Yego Innovision Ltd was completed at 2026-08-15 15:46:09. Balance:24415 RWF. Fee 0 RWF. FT Id: 29887752112. ET Id: T2-518732a1a1-5edae3.*RW#",
  expected: {
    external_transaction_id: "29887752112",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 11520,
    fee_rwf: 0,
    balance_after_rwf: 24415,
    counterparty_name: "Yego Innovision Ltd",
    counterparty_reference: null,
    occurred_at: "2026-08-15T15:46:09+02:00",
    parser_pattern: "generic_transaction",
  },
};

export const failedTransactionMessage = {
  raw:
    "*143*R*Y'ello, the transaction with amount 200 RWF for MTN RWANDACELL LIMITED with message: failed at 2026-08-16 16:22:21 .Please Contact MobileMoney Helpline for Assistance.Thank you for using MTN MobileMoney.*EN#",
  expected: {
    external_transaction_id: null,
    transaction_type: "other",
    direction: "out",
    status: "failed",
    amount_rwf: 200,
    fee_rwf: 0,
    balance_after_rwf: null,
    counterparty_name: "MTN RWANDACELL LIMITED",
    counterparty_reference: null,
    occurred_at: "2026-08-16T16:22:21+02:00",
    parser_pattern: "failed_transaction",
  },
};

// A merchant payment message with irregular internal whitespace (extra
// spaces, tabs, newlines) that normalizeMessage must collapse before the
// pattern can match. Should parse identically to merchantPaymentMessage.
export const whitespaceVariationMessage = {
  raw:
    "TxId:29946098339*S*Your   payment  of\t4,000  RWF\nto   KMLVIO CENTER AND MILK ZONE SHOP 093011   was completed at  2026-08-18   11:02:56 . Balance:   3,675 RWF.  Fee  0  RWF.*EN#",
  expected: merchantPaymentMessage.expected,
};

// Merchant payment with no "Fee" segment at all - fee must default to 0.
export const missingFeeMessage = {
  raw:
    "TxId:11111111111*S*Your payment of 1,200 RWF to SOME SHOP 044555 was completed at 2026-08-17 09:15:00. Balance: 500 RWF.*EN#",
  expected: {
    external_transaction_id: "11111111111",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 1200,
    fee_rwf: 0,
    balance_after_rwf: 500,
    counterparty_name: "SOME SHOP",
    counterparty_reference: "044555",
    occurred_at: "2026-08-17T09:15:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// Merchant payment with no "Balance" segment at all - balance must be null.
export const missingBalanceMessage = {
  raw:
    "TxId:22222222222*S*Your payment of 800 RWF to ANOTHER SHOP 077888 was completed at 2026-08-17 09:20:00. Fee 0 RWF.*EN#",
  expected: {
    external_transaction_id: "22222222222",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 800,
    fee_rwf: 0,
    balance_after_rwf: null,
    counterparty_name: "ANOTHER SHOP",
    counterparty_reference: "077888",
    occurred_at: "2026-08-17T09:20:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// Contains RWF but does not match any known MTN MoMo SMS structure.
export const unknownRwfMessage =
  "You have topped up your account with 5000 RWF successfully. Ref: ABC123";

// Timestamp is malformed ("19:XX:XX" is not HH:MM:SS), so no pattern -
// including the otherwise-matching airtime pattern - should match.
export const malformedTimestampMessage =
  "*162*TxId:29959252999*S*Your payment of 50 RWF to Airtime with token and ET Id: 29959252999 was completed at 2026-08-18 19:XX:XX. Fee 0 RWF. Balance: 2305 RWF.*RW#";

// A message shaped so that, absent correct precedence, the generic
// merchant-payment pattern could swallow it as a merchant named
// "Airtime with token ...". The airtime-specific pattern must win.
export const airtimeRegressionMessage = airtimeMessage.raw;

// ===========================================================================
// Additional coverage: realistic variations of currently supported formats.
// ===========================================================================

// Non-breaking space (U+00A0) characters throughout, as an iPhone Shortcut
// or clipboard copy can introduce them in place of ordinary spaces.
export const nbspVariationMessage = {
  raw:
    "TxId:29946098340*S*Your payment of 1,800 RWF to NBSP SHOP 088888 was completed at 2026-08-17 09:30:00. Fee 0 RWF. Balance: 200 RWF.*EN#",
  expected: {
    external_transaction_id: "29946098340",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 1800,
    fee_rwf: 0,
    balance_after_rwf: 200,
    counterparty_name: "NBSP SHOP",
    counterparty_reference: "088888",
    occurred_at: "2026-08-17T09:30:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// Same airtime shape as airtimeMessage but entirely lowercase, proving the
// parser is case-insensitive on both keywords and the "Airtime" literal.
export const lowercaseAirtimeMessage = {
  raw:
    "txid:29959252920*s*your payment of 100 rwf to airtime with token was completed at 2026-08-17 09:00:00. fee 0 rwf. balance: 500 rwf.*rw#",
  expected: {
    external_transaction_id: "29959252920",
    transaction_type: "airtime",
    direction: "out",
    status: "success",
    amount_rwf: 100,
    fee_rwf: 0,
    balance_after_rwf: 500,
    counterparty_name: "Airtime",
    counterparty_reference: null,
    occurred_at: "2026-08-17T09:00:00+02:00",
    parser_pattern: "airtime_payment",
  },
};

// Send money with "Fee:20RWF" - colon directly against the digits, no
// spaces anywhere in the fee segment.
export const feeNoSpaceColonMessage = {
  raw:
    "TxId:30000000001*S*1500 RWF transferred to Jane DOE (250788000111) at 2026-08-17 09:00:00.Fee:20RWF.Balance:480RWF.*RW#",
  expected: {
    external_transaction_id: "30000000001",
    transaction_type: "send_money",
    direction: "out",
    status: "success",
    amount_rwf: 1500,
    fee_rwf: 20,
    balance_after_rwf: 480,
    counterparty_name: "Jane DOE",
    counterparty_reference: "250788000111",
    occurred_at: "2026-08-17T09:00:00+02:00",
    parser_pattern: "send_money",
  },
};

// Merchant payment with "Fee: 15 RWF" - colon-plus-space on both sides.
export const feeColonSpacedMessage = {
  raw:
    "TxId:30000000002*S*Your payment of 600 RWF to SPACED FEE SHOP 066666 was completed at 2026-08-17 09:05:00. Fee: 15 RWF. Balance: 900 RWF.*EN#",
  expected: {
    external_transaction_id: "30000000002",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 600,
    fee_rwf: 15,
    balance_after_rwf: 900,
    counterparty_name: "SPACED FEE SHOP",
    counterparty_reference: "066666",
    occurred_at: "2026-08-17T09:05:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// "Balance:2455 RWF" - colon directly against the digits, no comma.
export const balanceNoSpaceNoCommaMessage = {
  raw:
    "TxId:30000000003*S*Your payment of 350 RWF to NOCOMMA SHOP 022222 was completed at 2026-08-17 09:10:00. Fee 0 RWF. Balance:2455 RWF.*EN#",
  expected: {
    external_transaction_id: "30000000003",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 350,
    fee_rwf: 0,
    balance_after_rwf: 2455,
    counterparty_name: "NOCOMMA SHOP",
    counterparty_reference: "022222",
    occurred_at: "2026-08-17T09:10:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// "Balance: 2,455 RWF" - colon-space and a thousands comma.
export const balanceSpacedCommaMessage = {
  raw:
    "TxId:30000000004*S*Your payment of 350 RWF to COMMA SHOP 033333 was completed at 2026-08-17 09:12:00. Fee 0 RWF. Balance: 2,455 RWF.*EN#",
  expected: {
    external_transaction_id: "30000000004",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 350,
    fee_rwf: 0,
    balance_after_rwf: 2455,
    counterparty_name: "COMMA SHOP",
    counterparty_reference: "033333",
    occurred_at: "2026-08-17T09:12:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// TxId and FT Id both present. extractTransactionId must prefer TxId, since
// it is checked first and is the primary customer-facing reference MTN
// prints for this message family.
export const bothTxIdAndFtIdMessage = {
  raw:
    "TxId:30000000005*S*Your payment of 900 RWF to DUAL ID SHOP 099999 was completed at 2026-08-17 09:15:00. Fee 0 RWF. Balance: 100 RWF. FT Id: 40000000005.*EN#",
  expected: {
    external_transaction_id: "30000000005",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 900,
    fee_rwf: 0,
    balance_after_rwf: 100,
    counterparty_name: "DUAL ID SHOP",
    counterparty_reference: "099999",
    occurred_at: "2026-08-17T09:15:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// ET Id present, but neither TxId nor FT Id. extractTransactionId does not
// recognize "ET Id" as a transaction-id source (documented gap, not a
// bug): external_transaction_id must be null.
export const etIdOnlyMessage = {
  raw:
    "S*Your payment of 900 RWF to ET ONLY SHOP 088888 was completed at 2026-08-17 09:18:00. Fee 0 RWF. Balance: 100 RWF. ET Id: T2-abc123.*EN#",
  expected: {
    external_transaction_id: null,
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 900,
    fee_rwf: 0,
    balance_after_rwf: 100,
    counterparty_name: "ET ONLY SHOP",
    counterparty_reference: "088888",
    occurred_at: "2026-08-17T09:18:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// Long merchant name with no trailing numeric reference: the whole name
// must be preserved and counterparty_reference must be null (the
// 5-plus-digit-suffix heuristic must not misfire on ordinary words).
export const longMerchantNameMessage = {
  raw:
    "TxId:30000000006*S*Your payment of 300 RWF to THE VERY LONG MERCHANT NAME FOR TESTING PURPOSES LTD was completed at 2026-08-17 09:20:00. Fee 0 RWF. Balance: 700 RWF.*EN#",
  expected: {
    external_transaction_id: "30000000006",
    transaction_type: "merchant_payment",
    direction: "out",
    status: "success",
    amount_rwf: 300,
    fee_rwf: 0,
    balance_after_rwf: 700,
    counterparty_name: "THE VERY LONG MERCHANT NAME FOR TESTING PURPOSES LTD",
    counterparty_reference: null,
    occurred_at: "2026-08-17T09:20:00+02:00",
    parser_pattern: "merchant_payment",
  },
};

// Send money to a masked recipient phone number, as MTN sometimes renders
// the counterparty reference with leading asterisks.
export const maskedSendMoneyMessage = {
  raw:
    "*165*S*2000 RWF transferred to John DOE (*******123) at 2026-08-17 09:25:00 .Fee: 0RWF.Balance: 300RWF.*RW#",
  expected: {
    external_transaction_id: null,
    transaction_type: "send_money",
    direction: "out",
    status: "success",
    amount_rwf: 2000,
    fee_rwf: 0,
    balance_after_rwf: 300,
    counterparty_name: "John DOE",
    counterparty_reference: "*******123",
    occurred_at: "2026-08-17T09:25:00+02:00",
    parser_pattern: "send_money",
  },
};

// Money received with comma-formatted amount and balance.
export const commaMoneyReceivedMessage = {
  raw:
    "You have received 1,250 RWF from Jane SMITH (250788111222) at 2026-08-17 09:28:00 . Balance:5,000 RWF. FT Id: 40000000007",
  expected: {
    external_transaction_id: "40000000007",
    transaction_type: "money_received",
    direction: "in",
    status: "success",
    amount_rwf: 1250,
    fee_rwf: 0,
    balance_after_rwf: 5000,
    counterparty_name: "Jane SMITH",
    counterparty_reference: "250788111222",
    occurred_at: "2026-08-17T09:28:00+02:00",
    parser_pattern: "money_received",
  },
};

// Failed transaction with a comma-formatted attempted amount. Same real
// wording pattern as failedTransactionMessage, only the amount format
// differs.
export const failedTransactionCommaAmountMessage = {
  raw:
    "*143*R*Y'ello, the transaction with amount 1,500 RWF for MTN RWANDACELL LIMITED with message: failed at 2026-08-16 17:05:00 .Please Contact MobileMoney Helpline for Assistance.Thank you for using MTN MobileMoney.*EN#",
  expected: {
    external_transaction_id: null,
    transaction_type: "other",
    direction: "out",
    status: "failed",
    amount_rwf: 1500,
    fee_rwf: 0,
    balance_after_rwf: null,
    counterparty_name: "MTN RWANDACELL LIMITED",
    counterparty_reference: null,
    occurred_at: "2026-08-16T17:05:00+02:00",
    parser_pattern: "failed_transaction",
  },
};

// ===========================================================================
// Unknown-format safety: these must all return null from parseMomoMessage.
// ===========================================================================

// A promotional message that happens to mention RWF - not a transaction
// confirmation at all.
export const promoMessage =
  "Dear Customer, enjoy double data bonus this weekend! Recharge with 500 RWF and get 1GB free. Dial *182# now!";

// A transaction confirmation cut off before the completion clause - must
// not be guessed at.
export const incompleteConfirmationMessage = "Your payment of 500 RWF to";

// Mentions RWF and "transaction" but has no amount, no completion clause,
// and no recognizable structure.
export const ambiguousMessage =
  "Your account was updated regarding a transaction of unknown amount in RWF.";

/**
 * Table-driven parser test matrix. Each entry with `expected: null` must
 * cause parseMomoMessage to return null. Each entry with a non-null
 * `expected` is verified field-by-field, including `parser_pattern`.
 */
export const parserTestCases = [
  { name: "airtime payment", ...airtimeMessage },
  { name: "merchant payment", ...merchantPaymentMessage },
  { name: "send money", ...sendMoneyMessage },
  { name: "money received", ...moneyReceivedMessage },
  { name: "generic merchant transaction", ...genericMerchantMessage },
  { name: "failed transaction", ...failedTransactionMessage },
  {
    name: "whitespace variation (tabs/newlines/repeated spaces)",
    ...whitespaceVariationMessage,
  },
  { name: "missing optional fee", ...missingFeeMessage },
  { name: "missing optional balance", ...missingBalanceMessage },
  { name: "NBSP-separated merchant payment", ...nbspVariationMessage },
  { name: "lowercase airtime payment", ...lowercaseAirtimeMessage },
  { name: "fee with no spaces (Fee:20RWF)", ...feeNoSpaceColonMessage },
  { name: "fee with colon and space (Fee: 15 RWF)", ...feeColonSpacedMessage },
  {
    name: "balance with no space, no comma (Balance:2455 RWF)",
    ...balanceNoSpaceNoCommaMessage,
  },
  {
    name: "balance with space and comma (Balance: 2,455 RWF)",
    ...balanceSpacedCommaMessage,
  },
  {
    name: "TxId preferred over FT Id when both present",
    ...bothTxIdAndFtIdMessage,
  },
  {
    name: "ET Id alone is not extracted as a transaction id",
    ...etIdOnlyMessage,
  },
  {
    name: "long merchant name with no numeric reference",
    ...longMerchantNameMessage,
  },
  { name: "masked recipient phone reference", ...maskedSendMoneyMessage },
  { name: "comma-formatted money received", ...commaMoneyReceivedMessage },
  {
    name: "failed transaction with comma-formatted amount",
    ...failedTransactionCommaAmountMessage,
  },
  {
    name: "unknown RWF message",
    raw: unknownRwfMessage,
    expected: null,
  },
  {
    name: "malformed timestamp",
    raw: malformedTimestampMessage,
    expected: null,
  },
  {
    name: "promotional message mentioning RWF",
    raw: promoMessage,
    expected: null,
  },
  {
    name: "incomplete transaction confirmation",
    raw: incompleteConfirmationMessage,
    expected: null,
  },
  {
    name: "ambiguous message with no recognizable structure",
    raw: ambiguousMessage,
    expected: null,
  },
] as const;
