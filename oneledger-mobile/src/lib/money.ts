// Port of web/lib/money.ts + the RWF formatters in web/lib/format.ts.
// Parsing/rounding matches the web exactly. Formatting is done by hand
// rather than with Intl.NumberFormat so output is identical on every device
// regardless of the JS engine's locale data; one deliberate difference from
// web formatMoney: negatives use the true minus sign "−", like the RWF
// formatters, instead of Intl's hyphen.

export type SupportedCurrency = "RWF" | "EUR" | "USD";

const CURRENCY_DECIMALS: Record<SupportedCurrency, number> = {
  RWF: 0,
  EUR: 2,
  USD: 2,
};

const DECIMAL_TEXT_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Converts a user-typed decimal string into integer minor units, exactly
 * (round-half-up on the decimal digits, never through a float).
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
  const padded = (fractionPart + "0".repeat(decimals + 1)).slice(
    0,
    decimals + 1,
  );
  const kept = padded.slice(0, decimals);
  const nextDigit = padded.slice(decimals, decimals + 1);

  let magnitude = BigInt(wholePart + kept);
  if (nextDigit !== "" && Number(nextDigit) >= 5) {
    magnitude += BigInt(1);
  }
  return sign === "-" ? -magnitude : magnitude;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a whole-RWF integer as "1,234 RWF" (no sign). */
export function formatRwf(amount: number): string {
  return `${groupThousands(String(Math.abs(Math.trunc(amount))))} RWF`;
}

/** Signed effect with an explicit prefix, e.g. "+7,500 RWF" / "−7,500 RWF". */
export function formatSignedRwf(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatRwf(amount)}`;
}

const CURRENCY_PREFIX: Record<SupportedCurrency, string> = {
  RWF: "RWF ",
  EUR: "€",
  USD: "$",
};

/** Display string from minor units, e.g. "RWF 500,000", "€1,250.00". */
export function formatMoney(
  amountMinor: bigint,
  currency: SupportedCurrency,
): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const negative = amountMinor < BigInt(0);
  const digits = (negative ? -amountMinor : amountMinor)
    .toString()
    .padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(-decimals)}` : "";
  return `${negative ? "−" : ""}${CURRENCY_PREFIX[currency]}${groupThousands(whole)}${fraction}`;
}
