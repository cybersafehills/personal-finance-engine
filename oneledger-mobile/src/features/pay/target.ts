// Which transactions can offer "Pay X again", and who to pay. Pure.
//
// Only the two kinds with a genuine verified USSD route are offered: a person
// (send money) and a business (merchant payment). Airtime is left out on
// purpose - the web directory resolves an airtime purchase to the *send-money*
// code, which would transfer money to that number instead of buying airtime -
// and bill payments have no verified route yet. The reference must also pass
// the server's own rules, so the button never leads to a form that cannot work.

export type PayAgainTarget =
  | { type: "pay_person"; msisdn: string; name: string | null }
  | { type: "pay_merchant"; merchantCode: string; name: string | null };

type TxnLike = {
  transaction_type: string;
  counterparty_reference: string | null;
  counterparty_name: string | null;
};

const RW_MOBILE = /^2507[2389]\d{7}$/;
const MERCHANT_CODE = /^\d{3,12}$/;

/**
 * `2507XXXXXXXX` for a Rwandan mobile number written as 07XXXXXXXX, 7XXXXXXXX,
 * 2507XXXXXXXX or +2507XXXXXXXX, else null. Same rule as the server's
 * normalizeRwandaMsisdn (web/lib/pay/phone.ts), so a number the app offers is
 * one the server accepts.
 */
export function normalizeRwandaMsisdn(input: string): string | null {
  const digits = input.trim().replace(/[^\d]/g, "");
  let candidate: string | null = null;
  if (/^250\d{9}$/.test(digits)) candidate = digits;
  else if (/^0\d{9}$/.test(digits)) candidate = "250" + digits.slice(1);
  else if (/^7\d{8}$/.test(digits)) candidate = "250" + digits;
  return candidate && RW_MOBILE.test(candidate) ? candidate : null;
}

/** `•••• ••• 4567`: only the last four digits. */
export function maskMsisdn(normalized: string): string {
  return `•••• ••• ${normalized.slice(-4)}`;
}

export function payAgainTarget(txn: TxnLike): PayAgainTarget | null {
  const ref = txn.counterparty_reference?.trim();
  if (!ref) return null;
  const name = txn.counterparty_name?.trim() || null;

  if (txn.transaction_type === "send_money") {
    const msisdn = normalizeRwandaMsisdn(ref);
    return msisdn ? { type: "pay_person", msisdn, name } : null;
  }
  if (txn.transaction_type === "merchant_payment") {
    return MERCHANT_CODE.test(ref) ? { type: "pay_merchant", merchantCode: ref, name } : null;
  }
  return null;
}
