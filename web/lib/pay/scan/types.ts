// Phase R2 - the "Scan to pay" payload domain model.
//
// Dependency-free and free of any Next/Node/Deno API so the whole
// pipeline runs identically in a Deno unit test, a React client
// component, and a server action. Nothing here touches the network, the
// camera, `window`, or a database - resolution against the verified USSD
// directory / the provider allowlist is injected (see pipeline.ts).
//
// Trust model (docs/adr/0006-qr-scan-payload-trust.md): a scan is DATA,
// never authorization. Every decoded string passes normalize -> classify
// -> per-type strict validation -> provider resolution -> allowlist/risk
// checks before it can become a ReviewModel. Anything unknown, malformed,
// suspicious, or unverifiable is rejected with a coarse reason category -
// never "opened anyway".

/** The mutually exclusive shapes a decoded QR can resolve to. */
export type PayloadClass =
  | "verified_ussd"
  | "provider_link"
  | "oneledger_payment"
  | "emv_merchant"
  | "unsupported"
  | "suspicious";

/**
 * Why a scan was rejected. Coarse on purpose - this is the ONLY thing
 * that may be logged or sent to analytics about a failed scan (never the
 * raw payload). Keep it a closed union so the UI copy map stays total.
 */
export type RejectionReason =
  | "empty"
  | "too_long"
  | "control_chars"
  | "deceptive_unicode"
  | "unsafe_scheme"
  | "embedded_credentials"
  | "unknown_scheme"
  | "malformed_ussd"
  | "unknown_ussd"
  | "provider_not_allowlisted"
  | "lookalike_host"
  | "oneledger_schema"
  | "oneledger_expired"
  | "oneledger_replay"
  | "amount_invalid"
  | "currency_invalid"
  | "emv_unsupported"
  | "emv_malformed"
  | "multiple_codes"
  | "not_recognised"
  | "needs_connection";

/** An exact money value. Minor units only - never a float, never a
 *  decimal string that could round. */
export type ScanAmount = {
  minor: number;
  /** ISO 4217, validated against KNOWN_CURRENCIES. */
  currency: string;
};

export type ReviewWarning =
  | "merchant_unverified"
  | "amount_missing"
  | "amount_user_entered"
  | "ussd_not_officially_verified";

/** A still-unfilled parameter of a scanned parameterised USSD code. R3
 *  collects these; R2 only surfaces that they exist. */
export type ScanUssdParam = {
  key: string;
  /** Best-effort kind from the directory entry, for the R3 input. */
  kind: string | null;
  required: boolean;
};

export type ScanRoute =
  | {
      kind: "ussd";
      /** The directory template, e.g. `*182*8*1*{merchant}*{amount}#`. */
      template: string;
      /** The exact literal that was scanned when it carried no
       *  placeholders, else null (R3 fills it). */
      literal: string | null;
      params: ScanUssdParam[];
      directorySlug: string;
    }
  | { kind: "provider_link"; provider: string; url: string }
  | {
      kind: "oneledger";
      provider: string | null;
      merchantIdMasked: string;
      /** ISO 4217 from the payload - the review needs it even when the
       *  payload carries no amount (the user enters one). */
      currency: string;
    };

/**
 * The validated, display-ready result of a supported scan. R3 renders
 * this; R2 shows a compact summary of it. It deliberately carries no raw
 * identifier - `recipientMasked` / `merchantIdMasked` are already
 * redacted per the app's privacy conventions.
 */
export type ReviewModel = {
  class: "verified_ussd" | "provider_link" | "oneledger_payment";
  route: ScanRoute;
  providerLabel: string | null;
  /** True only when a trusted source (the verified directory, a signed
   *  first-party payload) vouches for the merchant identity. */
  providerVerified: boolean;
  recipientMasked: string | null;
  /** null => the code carries no amount and the user must enter one in
   *  R3 (amountEditable is then true). */
  amount: ScanAmount | null;
  amountEditable: boolean;
  reference: string | null;
  description: string | null;
  invoiceId: string | null;
  /** ISO-8601, if the payload declares one. Already checked to be in
   *  the future at parse time. */
  expiresAt: string | null;
  warnings: ReviewWarning[];
};

export type ScanResult =
  | { ok: true; model: ReviewModel }
  | { ok: false; class: PayloadClass; reason: RejectionReason };

/** ISO 4217 codes the app is willing to represent. Not exhaustive - a
 *  scan in an unlisted currency is rejected rather than guessed. */
export const KNOWN_CURRENCIES: ReadonlySet<string> = new Set([
  "RWF", "USD", "EUR", "GBP", "KES", "UGX", "TZS", "BIF", "CDF", "ETB",
  "NGN", "GHS", "ZAR", "XAF", "XOF", "EGP", "MAD", "ZMW", "MWK", "SSP",
  "INR", "CNY", "JPY", "CAD", "AUD", "CHF", "AED", "SAR",
]);

/** Hard cap on a decoded payload before we even look at it (§5.3
 *  "Oversized payloads"). A real merchant QR is well under this. */
export const MAX_PAYLOAD_LENGTH = 4096;

/** Exclusive upper bound on any amount, in minor units (§5.3
 *  "Impossible or negative amounts"). */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;
