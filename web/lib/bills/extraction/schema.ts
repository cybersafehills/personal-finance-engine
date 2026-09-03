// Pure, zero-import validation of the raw model response for document
// classification + field extraction (master prompt §7/§8/§17). Deno-
// testable; the network call lives in provider.ts, which is not. Mirrors
// lib/ai/validate.ts: a malformed / oversized / wrong-shape response
// degrades to null, never a throw, and the deterministic pipeline treats
// null exactly like "extraction unavailable".

export const DOC_CLASSES = [
  "supplier_invoice",
  "receipt",
  "credit_note",
  "quotation",
  "proforma",
  "payment_confirmation",
  "bank_or_momo_statement",
  "unsupported",
  "unknown",
] as const;

export type DocClass = (typeof DOC_CLASSES)[number];

export type ExtractedFieldRaw = {
  value: string;
  confidence: number | null;
  page: number | null;
};

export type ExtractedLineRaw = {
  description: string | null;
  quantity: string | null;
  unit: string | null;
  unit_price: string | null;
  line_total: string | null;
  tax_rate: string | null;
  tax_amount: string | null;
  discount: string | null;
  page: number | null;
  confidence: number | null;
};

export type ExtractionModelOutput = {
  docClass: DocClass;
  docClassConfidence: number | null;
  fields: Record<string, ExtractedFieldRaw>;
  lineItems: ExtractedLineRaw[];
};

// The field keys the pipeline knows how to normalise + validate. The
// model may only return these; anything else is dropped (defence against
// a manipulated document steering the model into arbitrary keys).
export const KNOWN_FIELD_KEYS = [
  "supplier_name",
  "supplier_tax_id",
  "supplier_address",
  "supplier_email",
  "supplier_phone",
  "supplier_bank_details",
  "invoice_number",
  "receipt_number",
  "credit_note_number",
  "purchase_order_reference",
  "payment_reference",
  "issue_date",
  "receipt_date",
  "due_date",
  "payment_date",
  "service_period_start",
  "service_period_end",
  "currency",
  "subtotal",
  "tax_amount",
  "tax_rate",
  "discount_amount",
  "additional_charges",
  "total",
  "amount_paid",
  "outstanding_balance",
] as const;

const KNOWN_FIELD_SET = new Set<string>(KNOWN_FIELD_KEYS);

const MAX_FIELDS = 40;
const MAX_LINE_ITEMS = 200;
const MAX_VALUE_LEN = 400;
const MAX_DESC_LEN = 600;

function clampConfidence(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampPage(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5000) return null;
  return v;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/**
 * Parses `rawText` (a single JSON object, tolerating a leading/trailing
 * markdown code fence) into an ExtractionModelOutput, or null if it is
 * malformed, the wrong shape, or exceeds the bounds. Unknown field keys
 * are silently dropped; unknown doc_class values collapse to "unknown".
 */
export function parseAndValidateExtraction(rawText: string): ExtractionModelOutput | null {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  const rawClass = typeof obj.doc_class === "string" ? obj.doc_class.trim() : "";
  const docClass: DocClass = (DOC_CLASSES as readonly string[]).includes(rawClass)
    ? (rawClass as DocClass)
    : "unknown";
  const docClassConfidence = clampConfidence(obj.doc_class_confidence);

  const fields: Record<string, ExtractedFieldRaw> = {};
  const rawFields = obj.fields;
  if (rawFields != null && (typeof rawFields !== "object" || Array.isArray(rawFields))) {
    return null;
  }
  if (rawFields && typeof rawFields === "object") {
    let count = 0;
    for (const [key, entry] of Object.entries(rawFields as Record<string, unknown>)) {
      if (!KNOWN_FIELD_SET.has(key)) continue;
      if (++count > MAX_FIELDS) break;
      if (entry == null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const value = str(e.value, MAX_VALUE_LEN);
      if (value == null) continue;
      fields[key] = {
        value,
        confidence: clampConfidence(e.confidence),
        page: clampPage(e.page),
      };
    }
  }

  const lineItems: ExtractedLineRaw[] = [];
  const rawLines = obj.line_items;
  if (rawLines != null && !Array.isArray(rawLines)) return null;
  if (Array.isArray(rawLines)) {
    for (const entry of rawLines.slice(0, MAX_LINE_ITEMS)) {
      if (entry == null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      lineItems.push({
        description: str(e.description, MAX_DESC_LEN),
        quantity: str(e.quantity, 40),
        unit: str(e.unit, 40),
        unit_price: str(e.unit_price, 60),
        line_total: str(e.line_total, 60),
        tax_rate: str(e.tax_rate, 40),
        tax_amount: str(e.tax_amount, 60),
        discount: str(e.discount, 60),
        page: clampPage(e.page),
        confidence: clampConfidence(e.confidence),
      });
    }
  }

  return { docClass, docClassConfidence, fields, lineItems };
}
