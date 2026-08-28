import {
  KNOWN_CURRENCIES,
  MAX_AMOUNT_MINOR,
  type RejectionReason,
} from "./types";

// The OneLedger first-party payment payload (v1). A merchant QR the
// product controls end to end. R2 implements the PARSER only - generation
// is a later, separate piece of work - but the schema is versioned and
// documented now so the two stay in lockstep
// (docs/adr/0006-qr-scan-payload-trust.md).
//
// Strict by construction: unknown top-level keys are rejected, every
// field is type- and range-checked, an expired payload is refused, and a
// nonce already seen is refused (replay). A `merchant_name` in the
// payload is display-only and explicitly NOT trusted - providerVerified
// stays false unless a signature is present and verified (not in v1).

export type OneLedgerPayloadV1 = {
  v: 1;
  type: "merchant_payment";
  provider: string;
  merchant_id: string;
  merchant_name?: string;
  amount_minor?: number;
  currency: string;
  reference?: string;
  invoice_id?: string;
  description?: string;
  expires_at?: string;
  nonce?: string;
  country?: string;
};

const ALLOWED_KEYS = new Set([
  "v",
  "type",
  "provider",
  "merchant_id",
  "merchant_name",
  "amount_minor",
  "currency",
  "reference",
  "invoice_id",
  "description",
  "expires_at",
  "nonce",
  "country",
]);

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-/]{0,63}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

/** Strip anything non-printable and cap length - merchant_name /
 *  description are shown to the user but come from an unverified source. */
function sanitizeText(s: string, max: number): string {
  let out = "";
  for (let i = 0; i < s.length && out.length < max; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x1f && !(c >= 0x7f && c <= 0x9f)) out += s[i];
  }
  return out.trim();
}

export type ParsedOneLedger = {
  payload: OneLedgerPayloadV1;
  merchantName: string | null;
  description: string | null;
  amountMinor: number | null;
  currency: string;
  reference: string | null;
  invoiceId: string | null;
  expiresAt: string | null;
};

export type OneLedgerParseOpts = {
  /** Nonces already consumed (replay guard). */
  seenNonces?: ReadonlySet<string>;
  /** Injectable clock for tests. */
  now?: () => number;
};

export function parseOneLedgerPayload(
  raw: string,
  opts: OneLedgerParseOpts = {},
): { ok: true; value: ParsedOneLedger } | { ok: false; reason: RejectionReason } {
  const body = raw.replace(/^oneledger:/i, "").trim();

  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    return { ok: false, reason: "oneledger_schema" };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, reason: "oneledger_schema" };
  }
  const rec = obj as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, reason: "oneledger_schema" };
  }

  if (rec.v !== 1) return { ok: false, reason: "oneledger_schema" };
  if (rec.type !== "merchant_payment") return { ok: false, reason: "oneledger_schema" };

  if (typeof rec.provider !== "string" || !SLUG_RE.test(rec.provider)) {
    return { ok: false, reason: "oneledger_schema" };
  }
  if (typeof rec.merchant_id !== "string" || !ID_RE.test(rec.merchant_id)) {
    return { ok: false, reason: "oneledger_schema" };
  }
  if (typeof rec.currency !== "string" || !/^[A-Z]{3}$/.test(rec.currency)) {
    return { ok: false, reason: "currency_invalid" };
  }
  if (!KNOWN_CURRENCIES.has(rec.currency)) {
    return { ok: false, reason: "currency_invalid" };
  }

  let amountMinor: number | null = null;
  if (rec.amount_minor !== undefined) {
    const a = rec.amount_minor;
    if (
      typeof a !== "number" ||
      !Number.isInteger(a) ||
      a < 1 ||
      a >= MAX_AMOUNT_MINOR
    ) {
      return { ok: false, reason: "amount_invalid" };
    }
    amountMinor = a;
  }

  for (const [key, re] of [
    ["reference", REF_RE],
    ["invoice_id", ID_RE],
  ] as const) {
    const val = rec[key];
    if (val !== undefined && (typeof val !== "string" || !re.test(val))) {
      return { ok: false, reason: "oneledger_schema" };
    }
  }
  if (rec.country !== undefined) {
    if (typeof rec.country !== "string" || !COUNTRY_RE.test(rec.country)) {
      return { ok: false, reason: "oneledger_schema" };
    }
  }

  let expiresAt: string | null = null;
  if (rec.expires_at !== undefined) {
    if (typeof rec.expires_at !== "string") {
      return { ok: false, reason: "oneledger_schema" };
    }
    const ts = Date.parse(rec.expires_at);
    if (Number.isNaN(ts)) return { ok: false, reason: "oneledger_schema" };
    const now = opts.now ? opts.now() : Date.now();
    if (ts <= now) return { ok: false, reason: "oneledger_expired" };
    expiresAt = new Date(ts).toISOString();
  }

  if (rec.nonce !== undefined) {
    if (typeof rec.nonce !== "string" || !ID_RE.test(rec.nonce)) {
      return { ok: false, reason: "oneledger_schema" };
    }
    if (opts.seenNonces?.has(rec.nonce)) {
      return { ok: false, reason: "oneledger_replay" };
    }
  }

  const merchantName =
    typeof rec.merchant_name === "string"
      ? sanitizeText(rec.merchant_name, 80) || null
      : null;
  const description =
    typeof rec.description === "string"
      ? sanitizeText(rec.description, 140) || null
      : null;

  const payload: OneLedgerPayloadV1 = {
    v: 1,
    type: "merchant_payment",
    provider: rec.provider,
    merchant_id: rec.merchant_id,
    currency: rec.currency,
    ...(merchantName ? { merchant_name: merchantName } : {}),
    ...(amountMinor !== null ? { amount_minor: amountMinor } : {}),
    ...(typeof rec.reference === "string" ? { reference: rec.reference } : {}),
    ...(typeof rec.invoice_id === "string" ? { invoice_id: rec.invoice_id } : {}),
    ...(description ? { description } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(typeof rec.nonce === "string" ? { nonce: rec.nonce } : {}),
    ...(typeof rec.country === "string" ? { country: rec.country } : {}),
  };

  return {
    ok: true,
    value: {
      payload,
      merchantName,
      description,
      amountMinor,
      currency: rec.currency,
      reference: typeof rec.reference === "string" ? rec.reference : null,
      invoiceId: typeof rec.invoice_id === "string" ? rec.invoice_id : null,
      expiresAt,
    },
  };
}

/** `•••• 4567`-style mask for a merchant id shown on the review screen. */
export function maskMerchantId(id: string): string {
  const tail = id.slice(-4);
  return id.length <= 4 ? tail : `•••• ${tail}`;
}
