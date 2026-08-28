import {
  parseAndValidateExtraction,
  type ExtractionModelOutput,
} from "./schema";
import { EXTRACTION_RULESET_VERSION } from "./prompt";
import type { ExtractionCallResult } from "./types";
import {
  normalizeCurrencyCode,
  normalizeDate,
  normalizeDecimalString,
  normalizeMoneyToMinor,
  normalizeTaxRate,
} from "../normalize";

// Turns a raw provider response into the payload for the
// record_bill_extraction() RPC: parse -> validate shape -> normalise
// every value -> map each known field to a value_type. Never throws; an
// unusable response produces a status:'failed' payload so the worker can
// still record the attempt and fail the document cleanly.

const DATE_FIELDS = new Set([
  "issue_date",
  "receipt_date",
  "due_date",
  "payment_date",
  "service_period_start",
  "service_period_end",
]);
const MONEY_FIELDS = new Set([
  "subtotal",
  "tax_amount",
  "discount_amount",
  "additional_charges",
  "total",
  "amount_paid",
  "outstanding_balance",
]);

export type ExtractionRecordPayload = Record<string, unknown>;

export function buildExtractionRecordPayload(args: {
  billDocumentId: string;
  workspaceId: string;
  call: ExtractionCallResult | null;
}): ExtractionRecordPayload {
  const { billDocumentId, workspaceId, call } = args;

  const base = {
    bill_document_id: billDocumentId,
    workspace_id: workspaceId,
    ruleset_version: EXTRACTION_RULESET_VERSION,
    provider: call?.provider ?? null,
    model: call?.model ?? null,
    request_id: call?.requestId ?? null,
    duration_ms: call?.durationMs ?? null,
    usage: call?.usage ?? null,
  };

  if (!call) {
    return {
      ...base,
      status: "failed",
      error: { kind: "provider_unavailable" },
    };
  }

  const output = parseAndValidateExtraction(call.rawText);
  if (!output) {
    return {
      ...base,
      status: "failed",
      error: { kind: "invalid_response" },
    };
  }

  const docCurrency =
    normalizeCurrencyCode(output.fields.currency?.value ?? null) ?? null;

  return {
    ...base,
    status: "succeeded",
    doc_class: output.docClass,
    doc_class_confidence: output.docClassConfidence,
    fields: buildFields(output, docCurrency),
    line_items: buildLineItems(output, docCurrency),
  };
}

function buildFields(
  output: ExtractionModelOutput,
  docCurrency: string | null,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (const [key, field] of Object.entries(output.fields)) {
    const raw = field.value;
    let valueType = "string";
    let normalized: string | null = raw.trim();
    let currency: string | null = null;

    if (DATE_FIELDS.has(key)) {
      valueType = "date";
      normalized = normalizeDate(raw);
    } else if (key === "currency") {
      valueType = "string";
      normalized = normalizeCurrencyCode(raw);
    } else if (key === "tax_rate") {
      valueType = "decimal";
      normalized = normalizeTaxRate(raw);
    } else if (MONEY_FIELDS.has(key)) {
      valueType = "money_minor";
      const m = normalizeMoneyToMinor(raw, docCurrency);
      if (m) {
        normalized = m.minor;
        currency = m.currency;
      } else {
        normalized = null;
      }
    }

    rows.push({
      field_key: key,
      value_type: valueType,
      raw_value: raw,
      normalized_value: normalized,
      currency,
      confidence: field.confidence,
      source_page: field.page,
      method: "model",
    });
  }

  return rows;
}

function buildLineItems(
  output: ExtractionModelOutput,
  docCurrency: string | null,
): Array<Record<string, unknown>> {
  return output.lineItems.map((line, index) => {
    const money = (raw: string | null) =>
      raw && docCurrency ? normalizeMoneyToMinor(raw, docCurrency)?.minor ?? null : null;

    return {
      line_index: index,
      description: line.description,
      quantity: line.quantity ? normalizeDecimalString(line.quantity) : null,
      unit: line.unit,
      unit_price_minor: money(line.unit_price),
      currency: docCurrency,
      tax_rate: line.tax_rate ? normalizeTaxRate(line.tax_rate) : null,
      tax_amount_minor: money(line.tax_amount),
      discount_minor: money(line.discount),
      line_total_minor: money(line.line_total),
      confidence: line.confidence,
      source_page: line.page,
    };
  });
}
