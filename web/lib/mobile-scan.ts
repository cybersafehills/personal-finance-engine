// Request parsing for the mobile app's Scan to pay routes
// (POST /api/mobile/pay/scan/classify and /prepare). Pure: no server-only
// imports, so it is `deno test`-able. The scanned string is DATA, never
// authorization (docs/adr/0006-qr-scan-payload-trust.md): the server re-parses
// it from the raw text, and the only client number it accepts is the amount the
// user types when a code carries none.

/** Matches the web action's own cap on a decoded payload. */
export const MAX_RAW_LENGTH = 8192;

export type ParsedRaw = { ok: true; raw: string } | { ok: false; message: string };

function parseRaw(body: unknown): ParsedRaw {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Send the scanned code as JSON." };
  }
  const raw = (body as Record<string, unknown>).raw;
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, message: "There was no code to read." };
  }
  if (raw.length > MAX_RAW_LENGTH) {
    return { ok: false, message: "That code is too long to be a payment code." };
  }
  return { ok: true, raw };
}

export function parseClassifyBody(body: unknown): ParsedRaw {
  return parseRaw(body);
}

export type ParsedPrepare =
  | { ok: true; raw: string; amountMinor?: number }
  | { ok: false; message: string };

export function parsePrepareBody(body: unknown): ParsedPrepare {
  const parsed = parseRaw(body);
  if (!parsed.ok) return parsed;
  const amount = (body as Record<string, unknown>).amountMinor;
  if (amount === undefined || amount === null) return { ok: true, raw: parsed.raw };
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: "Enter an amount greater than zero." };
  }
  return { ok: true, raw: parsed.raw, amountMinor: amount };
}
