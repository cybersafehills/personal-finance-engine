// Prepaid-electricity ("Cash Power") receipts as the VENDOR sends them.
//
// Real samples (supplied by the owner, 2026-11-16) show the token does NOT
// arrive inside the MTN MoMo payment confirmation. It comes in a SEPARATE SMS
// from the electricity vendor's own sender, in one of two wordings:
//
//   cashpower_en (English)            tokeni_rw (Kinyarwanda)
//   ----------------------            ------------------------
//   Cashpower Token:                  18/07/2026:
//   NNNN-NNNN-NNNN-NNNN-NNNN          Tokeni:
//   Purchased 11.90 KWh for           NNNN-NNNN-NNNN-NNNN-NNNN
//   5,000 RWF,                        Konteri: <meter>
//   Meter# <meter>                    (<METER OWNER NAME>)
//   TxID: <number>                    1,000 RWF = 2.4 kWh
//                                     TXNID: K<number>
//
// This parser extracts those fields. It is PURE and not yet wired into any
// ingestion path (see docs/oneledger-3/e7-utility-receipts.md for why and what
// the owner must decide). Strict by design: if any required field is missing or
// malformed it returns null - it never guesses. The meter number and the owner
// name are personal data; the owner name is deliberately NOT extracted at all.

export type UtilityReceipt = {
  format: "cashpower_en" | "tokeni_rw";
  /** 20 digits, no separators. A bearer value: encrypt before storing, never display. */
  token: string;
  /** Energy bought, dot-decimal ("11.9"). */
  kwh: string;
  /** Whole RWF paid. */
  amountRwf: number;
  /** Meter number as printed (8-14 digits), or null. Personal data. */
  meter: string | null;
  /** The vendor's own transaction reference (NOT the MoMo TxId), or null. */
  vendorTxId: string | null;
  /** YYYY-MM-DD printed on the first line of the Kinyarwanda format, else null. */
  receiptDate: string | null;
};

// Exactly five groups of four; a sixth dash-joined group means it is not a 20-digit token.
const TOKEN = String.raw`(\d{4}(?:[-\s]\d{4}){4})(?![-]?\d)`;
const EN_TOKEN = new RegExp(
  String.raw`\bcash\s?power\s+token\s*:?\s*${TOKEN}(?!\d)`,
  "i",
);
const RW_TOKEN = new RegExp(String.raw`\btokeni\s*:?\s*${TOKEN}`, "i");
const EN_BODY =
  /\bpurchased\s+(\d+(?:[.,]\d+)?)\s*kwh\s+for\s+([\d,]+)\s*rwf\b/i;
const RW_BODY = /([\d,]+)\s*rwf\s*=\s*(\d+(?:[.,]\d+)?)\s*kwh\b/i;
const METER = /\b(?:meter\s*#?|konteri)\s*:?\s*(\d{8,14})\b/i;
const VENDOR_TX = /\btxn?id\s*:?\s*([A-Z0-9]{8,24})\b/i;
const RW_DATE = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*:/;

const digits = (s: string) => s.replace(/[^0-9]/g, "");
const wholeRwf = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const kwhOf = (s: string): string | null => {
  const v = s.replace(",", ".");
  return /^\d+(\.\d+)?$/.test(v) && Number(v) > 0
    ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
    : null;
};

function validDate(d: string, m: string, y: string): string | null {
  const day = Number(d), month = Number(m), year = Number(y);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 || dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day
  ) return null;
  return `${y}-${m}-${d}`;
}

export function parseUtilityReceipt(rawMessage: string): UtilityReceipt | null {
  const message = rawMessage.replace(/\r/g, "").replace(/[ \t]+/g, " ");

  let format: UtilityReceipt["format"];
  let tokenMatch: RegExpExecArray | null;
  let amount: number | null;
  let kwh: string | null;

  const en = EN_TOKEN.exec(message);
  const rw = RW_TOKEN.exec(message);
  if (en && !rw) {
    const body = EN_BODY.exec(message);
    if (!body) return null;
    format = "cashpower_en";
    tokenMatch = en;
    kwh = kwhOf(body[1]);
    amount = wholeRwf(body[2]);
  } else if (rw && !en) {
    const body = RW_BODY.exec(message);
    if (!body) return null;
    format = "tokeni_rw";
    tokenMatch = rw;
    amount = wholeRwf(body[1]);
    kwh = kwhOf(body[2]);
  } else {
    return null; // neither, or ambiguous
  }

  const token = digits(tokenMatch[1]);
  if (token.length !== 20 || amount === null || kwh === null) return null;

  const dateMatch = format === "tokeni_rw" ? RW_DATE.exec(message) : null;
  return {
    format,
    token,
    kwh,
    amountRwf: amount,
    meter: METER.exec(message)?.[1] ?? null,
    vendorTxId: VENDOR_TX.exec(message)?.[1]?.toUpperCase() ?? null,
    receiptDate: dateMatch
      ? validDate(dateMatch[1], dateMatch[2], dateMatch[3])
      : null,
  };
}

// ------------------------------------------------------------------------
// Helpers for storing a receipt (used by process-raw-events).
// ------------------------------------------------------------------------

/** "11.9" -> 11900 (kWh x 1000, exact integer, no floats). null if it would lose precision. */
export function kwhToMilli(kwh: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(kwh);
  if (!m) return null;
  const n = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Last four digits of a meter number (the only part we keep), or null. */
export function meterLast4(meter: string | null): string | null {
  return meter && /^\d{8,14}$/.test(meter) ? meter.slice(-4) : null;
}

/**
 * Replace any 20-digit token (5 groups of 4) with a marker, so the raw evidence
 * row no longer holds a bearer value once the receipt has been processed.
 */
export function redactUtilityToken(message: string): string {
  return message.replace(/\d{4}(?:[-\s]\d{4}){4}(?!\d)/g, "[token removed]");
}

/** sha256 hex of the vendor's own reference (or the token when there is none): a re-delivered SMS is then a no-op. */
export async function vendorRefHash(r: UtilityReceipt): Promise<string> {
  const data = new TextEncoder().encode(`utility:${r.vendorTxId ?? r.token}`);
  const d = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}
