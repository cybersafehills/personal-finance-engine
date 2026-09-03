// Pure, zero-import normalisation for extracted document fields (master
// prompt §8: "Normalize: Dates, Decimal values, Thousand separators,
// Currency codes, Tax percentages, Negative values, Country-specific
// number formats, Supplier naming variations"). Deno-testable, no
// framework dependency - the extraction pipeline
// (web/lib/bills/extraction/) calls this before anything is persisted.
//
// Every function is total: it returns null (or the input unchanged, where
// noted) rather than throwing, so a weird value from the model degrades
// to "not normalised" instead of failing the whole run.

// --- currency --------------------------------------------------------

// ISO 4217 minor-unit exponents for the currencies a Rwanda-centric
// finance app plausibly sees on a supplier document. Anything not listed
// is treated as 2-decimal (the overwhelmingly common case) once it is a
// valid 3-letter code.
const CURRENCY_DECIMALS: Record<string, number> = {
  RWF: 0, UGX: 0, TZS: 0, KES: 2, BIF: 0, XAF: 0, XOF: 0,
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0,
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, CNY: 2, INR: 2, ZAR: 2, AED: 2,
  BHD: 3, KWD: 3, OMR: 3, TND: 3, JOD: 3,
};

const SYMBOL_TO_CODE: Record<string, string> = {
  "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR",
  "frw": "RWF", "rwf": "RWF", "rf": "RWF",
  "ush": "UGX", "ksh": "KES", "tsh": "TZS",
};

/** A canonical uppercase ISO 4217 code, or null. Accepts a symbol
 *  ("$", "€", "FRw"), a code in any case, or a code with surrounding
 *  noise ("USD ", "(EUR)"). */
export function normalizeCurrencyCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase().replace(/[()[\].]/g, "").trim();
  if (!trimmed) return null;
  if (SYMBOL_TO_CODE[trimmed]) return SYMBOL_TO_CODE[trimmed];
  const code = trimmed.toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length === 3) return code;
  // A leading symbol glued to digits ("$1,200") - pull the symbol.
  const sym = raw.trim()[0];
  if (SYMBOL_TO_CODE[sym]) return SYMBOL_TO_CODE[sym];
  return null;
}

export function currencyMinorDigits(code: string): number {
  return CURRENCY_DECIMALS[code.toUpperCase()] ?? 2;
}

// --- decimals / thousands separators --------------------------------

/** Turns a locale-formatted amount string into a canonical
 *  `"-?digits(.digits)?"` string, or null. Handles:
 *    "1,234.56"  (en)     -> "1234.56"
 *    "1.234,56"  (de/fr)  -> "1234.56"
 *    "1 234,56"  (fr)     -> "1234.56"
 *    "1'234.56"  (ch)     -> "1234.56"
 *    "(1,234.56)" accounting negative -> "-1234.56"
 *    "RWF 500 000" / "$1,200" -> strips the currency token
 */
export function normalizeDecimalString(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }

  // Drop everything that isn't a digit, separator, or space.
  s = s.replace(/[^\d.,'\u00a0 ]/g, "").trim();
  s = s.replace(/[\u00a0']/g, " ");
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;

  if (lastDot !== -1 && lastComma !== -1) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastComma !== -1) {
    // A lone comma: decimal separator only if it looks like one
    // (1-2 trailing digits and it's the only comma), else a thousands sep.
    const after = s.slice(lastComma + 1).replace(/\s/g, "");
    decimalSep = s.indexOf(",") === lastComma && after.length > 0 && after.length <= 2 ? "," : null;
  } else if (lastDot !== -1) {
    const after = s.slice(lastDot + 1).replace(/\s/g, "");
    decimalSep = s.indexOf(".") === lastDot && after.length > 0 && after.length <= 2 ? "." : null;
  }

  let intPart: string;
  let fracPart = "";
  if (decimalSep) {
    const idx = decimalSep === "." ? lastDot : lastComma;
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  } else {
    intPart = s;
  }

  intPart = intPart.replace(/[.,\s]/g, "");
  fracPart = fracPart.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(intPart)) return null;
  if (fracPart && !/^\d+$/.test(fracPart)) return null;

  const intNorm = intPart.replace(/^0+(?=\d)/, "");
  const canonical = fracPart ? `${intNorm}.${fracPart}` : intNorm;
  const isZero = /^0(\.0+)?$/.test(canonical);
  return (negative && !isZero ? "-" : "") + canonical;
}

// --- money to minor units (exact, no float) -------------------------

/** Exact conversion of a decimal string to integer minor units for
 *  `currency`, as a base-10 string (never a JS number). Round-half-up on
 *  the first dropped digit, mirroring lib/money.ts's toMinorUnits. */
export function decimalStringToMinor(
  decimal: string,
  currency: string,
): string | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  const decimals = currencyMinorDigits(currency);
  const padded = (frac + "0".repeat(decimals + 1)).slice(0, decimals + 1);
  const kept = padded.slice(0, decimals);
  const next = padded.slice(decimals, decimals + 1);
  let magnitude = BigInt(whole + kept);
  if (next !== "" && Number(next) >= 5) magnitude += 1n;
  return (sign === "-" && magnitude !== 0n ? "-" : "") + magnitude.toString();
}

/** raw amount text + a currency hint -> { minor, currency } or null. */
export function normalizeMoneyToMinor(
  raw: string | null | undefined,
  currencyHint: string | null | undefined,
): { minor: string; currency: string } | null {
  const currency =
    normalizeCurrencyCode(currencyHint) ?? normalizeCurrencyCode(raw ?? "");
  if (!currency) return null;
  const decimal = normalizeDecimalString(raw);
  if (decimal == null) return null;
  const minor = decimalStringToMinor(decimal, currency);
  if (minor == null) return null;
  return { minor, currency };
}

// --- dates ----------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Returns an ISO `YYYY-MM-DD` string, or null. Handles ISO,
 *  `DD/MM/YYYY`, `MM/DD/YYYY` (disambiguated when a component > 12),
 *  `DD Mon YYYY`, `Mon DD, YYYY`, and 2-digit years (>= 70 -> 19xx,
 *  else 20xx). Ambiguous DD/MM vs MM/DD defaults to DD/MM (the format on
 *  most non-US supplier documents this app sees). */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2];
    const y = normYear(+m[3]);
    // b can't be a month -> MM/DD form (a is the month).
    if (b > 12 && a <= 12) return iso(y, a, b);
    // a can't be a month -> DD/MM form (b is the month).
    if (a > 12 && b <= 12) return iso(y, b, a);
    // Ambiguous -> DD/MM (the format on most non-US supplier documents).
    return iso(y, b, a);
  }

  m = /^(\d{1,2})[ \-]([a-z]{3,4})[ \-,]+(\d{2,4})$/.exec(s);
  if (m && MONTHS[m[2]]) return iso(normYear(+m[3]), MONTHS[m[2]], +m[1]);

  m = /^([a-z]{3,4})[ \-]+(\d{1,2}),?[ \-]+(\d{2,4})$/.exec(s);
  if (m && MONTHS[m[1]]) return iso(normYear(+m[3]), MONTHS[m[1]], +m[2]);

  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);

  return null;
}

function normYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

// --- tax rate -----------------------------------------------------

/** "18%", "0.18", "18", "VAT 18 %" -> the string "18" (percent, no
 *  trailing %); null if it can't be read as a plausible 0-100 rate. */
export function normalizeTaxRate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[^\d.,-]/g, "");
  const decimal = normalizeDecimalString(s);
  if (decimal == null) return null;
  let n = Number(decimal);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1) n = n * 100; // 0.18 -> 18
  if (n < 0 || n > 100) return null;
  // Keep up to 4 dp, trim trailing zeros.
  return String(Number(n.toFixed(4)));
}

// --- supplier name ----------------------------------------------

/** A comparison key for supplier-name matching: lowercased, common
 *  company suffixes and punctuation removed, whitespace collapsed. The
 *  DISPLAY name is never altered by this - it feeds candidate matching
 *  only. */
export function normalizeSupplierName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[.,/#!$%^&*;:{}=_`~()"'\\-]/g, " ");
  s = s.replace(
    /\b(ltd|limited|llc|inc|incorporated|co|company|corp|corporation|plc|gmbh|sarl|sa|sas|bv|pvt|pty|group|holdings|enterprises?|services?|solutions?)\b/g,
    " ",
  );
  s = s.replace(/\s+/g, " ").trim();
  return s || null;
}
