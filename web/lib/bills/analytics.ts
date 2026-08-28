// Privacy-conscious product-event tracking and structured monitoring for
// the Bills & Expenses surface (master prompt §13/§25). Mirrors
// lib/pay/scan-analytics.ts exactly: this codebase has NO analytics
// provider or APM wired in, so this module is the single place a sink
// would attach, and it hard-strips anything resembling personal,
// supplier, or financial-document data BEFORE it could leave the process
// - keeping the redaction unit-testable whether or not a sink exists.
//
// Phase 1 emits only the intake + lifecycle events. Later phases add
// extraction / validation / duplicate / match / approval / posting
// events - always coarse enums, NEVER a filename, supplier name, amount,
// invoice number, or any OCR text.

export type BillEventName =
  // Phase 1 - intake + lifecycle
  | "bill_uploaded"
  | "bill_upload_rejected"
  | "bill_status_changed"
  | "bill_original_downloaded"
  | "bill_archived"
  // Phase 2+ - declared now
  | "bill_processing_completed"
  | "bill_review_opened"
  | "bill_field_corrected"
  | "bill_supplier_selected"
  | "bill_match_confirmed"
  | "bill_match_rejected"
  | "bill_approved"
  | "bill_rejected"
  | "bill_posting_completed"
  | "bill_processing_retried";

// Keys that must never reach analytics, and value shapes that look like
// raw identifiers. Same guard family as the Pay/directory modules.
const FORBIDDEN_KEY =
  /file\s*name|filename|supplier|vendor|merchant|amount|total|currency|invoice|receipt|reference|tax|tin|iban|account|email|phone|msisdn|name|address|ocr|text|payload|raw|national_id|nid/i;
const LOOKS_LIKE_IDENTIFIER = /(\d[\s-]?){6,}|https?:\/\//i;

export function sanitizeBillEventProps(
  props: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (LOOKS_LIKE_IDENTIFIER.test(value)) continue;
      out[key] = value.slice(0, 64);
    }
  }
  return out;
}

export function trackBillEvent(
  name: BillEventName,
  props?: Record<string, unknown>,
): void {
  const safe = sanitizeBillEventProps(props);
  // No provider connected. When one is added, forward `{ name, ...safe }`
  // here - never the raw `props`.
  if (process.env.NODE_ENV !== "production") {
    console.debug("[bill-event]", name, safe);
  }
}

// --- Monitoring -------------------------------------------------------

export type BillErrorStage =
  | "upload"
  | "storage_put"
  | "record"
  | "transition"
  | "signed_url"
  | "archive";

/** Strip anything resembling a raw identifier / URL out of an error
 *  message, and cap it. An Error's `.message` can quote a filename or a
 *  storage key; the stack is never logged. */
export function redactBillErrorText(input: unknown): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : "unknown error";
  return raw
    .replace(/\d(?:[\s-]?\d){5,}/g, "‹redacted›")
    .replace(/https?:\/\/\S+/gi, "‹redacted-url›")
    .replace(/[0-9a-f]{64}/gi, "‹redacted-hash›")
    .slice(0, 200);
}

export function logBillError(stage: BillErrorStage, err: unknown): void {
  // The platform log drain is the monitoring sink for this codebase
  // (mirrors the cron routes' and scan module's console.error usage).
  console.error(`[bill-error] stage=${stage}`, redactBillErrorText(err));
}
