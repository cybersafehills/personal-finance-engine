// Currency-generic money helpers, independent of any budgeting concept.
// Deliberately has zero imports so it can be unit-tested directly with
// `deno test` (see money_test.ts), matching this repository's established
// pattern of testing pure financial logic with Deno rather than adding a
// web/ test runner (see supabase/functions/ingest-momo/tests/).
//
// All budgeting/goal amounts are stored and computed in MINOR UNITS
// (bigint) of their own currency - RWF has 0 decimal places (1 minor unit
// = 1 RWF), EUR/USD have 2 (1 minor unit = 1 cent). This mirrors, but is
// intentionally separate from, transactions' `_rwf` columns: those are
// hardcoded to RWF (the only currency any ingestion path produces today),
// while budgets/goals must support RWF, EUR, and USD.

export type SupportedCurrency = "RWF" | "EUR" | "USD";

export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = [
  "RWF",
  "EUR",
  "USD",
];

const CURRENCY_DECIMALS: Record<SupportedCurrency, number> = {
  RWF: 0,
  EUR: 2,
  USD: 2,
};

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function minorUnitsPerMajor(currency: SupportedCurrency): number {
  return 10 ** CURRENCY_DECIMALS[currency];
}

const DECIMAL_TEXT_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Converts a user-typed decimal amount string (e.g. "1250.50" EUR,
 * "500000" RWF) into integer minor units. Takes the raw text, not a
 * `number` - a form input's value is text before it's anything else, and
 * parsing the digits directly (rather than `parseFloat` + multiply) is
 * what makes this exact: a double can't represent every decimal fraction
 * (1.005 is actually stored as ~1.00499999999999989...), so multiplying
 * a float and rounding the result can silently round the wrong way right
 * at a currency's own precision boundary. Round-half-up on the exact
 * decimal digits is the deterministic rounding rule for this boundary -
 * the only place a fractional minor unit can ever arise, since every
 * stored/computed value downstream is an exact bigint.
 */
export function toMinorUnits(
  amountText: string,
  currency: SupportedCurrency,
): bigint {
  const match = DECIMAL_TEXT_PATTERN.exec(amountText.trim());
  if (!match) {
    throw new RangeError(
      `amountText must be a plain decimal number, got ${JSON.stringify(amountText)}`,
    );
  }
  const [, sign, wholePart, fractionPart = ""] = match;
  const decimals = CURRENCY_DECIMALS[currency];

  // Pad/truncate the fraction to exactly decimals+1 digits, so there is
  // always one well-defined "next digit" to base half-up rounding on.
  const padded = (fractionPart + "0".repeat(decimals + 1)).slice(
    0,
    decimals + 1,
  );
  const kept = padded.slice(0, decimals);
  const nextDigit = padded.slice(decimals, decimals + 1);

  let magnitude = BigInt(wholePart + kept);
  if (nextDigit !== "" && Number(nextDigit) >= 5) {
    magnitude += 1n;
  }

  return sign === "-" ? -magnitude : magnitude;
}

/** Converts integer minor units back into a major-unit number for display math. */
export function toMajorUnits(
  amountMinor: bigint,
  currency: SupportedCurrency,
): number {
  const scale = minorUnitsPerMajor(currency);
  return Number(amountMinor) / scale;
}

const CURRENCY_LOCALE: Record<SupportedCurrency, string> = {
  RWF: "en-RW",
  EUR: "de-DE",
  USD: "en-US",
};

/** Locale-aware display string, e.g. "RWF 500,000", "€1,250.00", "$1,250.00". */
export function formatMoney(
  amountMinor: bigint,
  currency: SupportedCurrency,
): string {
  const major = toMajorUnits(amountMinor, currency);
  const formatter = new Intl.NumberFormat(CURRENCY_LOCALE[currency], {
    style: "currency",
    currency,
    minimumFractionDigits: CURRENCY_DECIMALS[currency],
    maximumFractionDigits: CURRENCY_DECIMALS[currency],
  });
  return formatter.format(major);
}

/**
 * Divides `numerator` by `denominator` and rounds to the nearest integer
 * (half-up on the absolute value), staying in exact bigint arithmetic
 * throughout - never routes through a floating-point intermediate, unlike
 * toMinorUnits above (which must, since its input is inherently a
 * user-typed decimal). Used for monthly/annual income normalization.
 */
export function divRoundBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError("divRoundBigInt: denominator must not be zero");
  }
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (absNumerator * 2n + absDenominator) / (absDenominator * 2n);
  return negative ? -quotient : quotient;
}
