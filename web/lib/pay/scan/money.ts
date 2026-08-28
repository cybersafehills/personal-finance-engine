import type { ScanAmount } from "./types.ts";

// Minor-unit -> display for scanned amounts. Exact integer arithmetic
// only: split on the decimal exponent, never divide a float. The
// zero-decimal currencies below (notably RWF, the primary market) store
// their minor unit == the currency itself, so `5000` RWF is "5,000",
// not "50.00".

const ZERO_DECIMAL = new Set([
  "RWF", "BIF", "CDF", "DJF", "GNF", "JPY", "KMF", "KRW", "PYG", "UGX",
  "VND", "VUV", "XAF", "XOF", "XPF", "CLP", "ISK",
]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyMinorDigits(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** `RWF 5,000` / `USD 12.50`. Grouping via Intl on the integer part
 *  only; the fractional part is a zero-padded slice of the minor value. */
export function formatScanAmount(amount: ScanAmount): string {
  const digits = currencyMinorDigits(amount.currency);
  const sign = amount.minor < 0 ? "-" : "";
  const abs = Math.abs(amount.minor);

  if (digits === 0) {
    return `${amount.currency} ${sign}${abs.toLocaleString("en-US")}`;
  }
  const scale = 10 ** digits;
  const whole = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(digits, "0");
  return `${amount.currency} ${sign}${whole.toLocaleString("en-US")}.${frac}`;
}
