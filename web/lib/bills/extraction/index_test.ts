import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildExtractionRecordPayload } from "./index.ts";
import type { ExtractionCallResult } from "./types.ts";

function call(rawText: string): ExtractionCallResult {
  return {
    rawText,
    provider: "mock",
    model: "mock",
    requestId: "r1",
    durationMs: 12,
    usage: null,
  };
}

const GOOD = JSON.stringify({
  doc_class: "supplier_invoice",
  doc_class_confidence: 0.96,
  fields: {
    supplier_name: { value: "Kigali Office Supplies Ltd", confidence: 0.95, page: 1 },
    invoice_number: { value: "INV-2026-0442", confidence: 0.97, page: 1 },
    issue_date: { value: "12/08/2026", confidence: 0.93, page: 1 },
    currency: { value: "RWF", confidence: 0.99, page: 1 },
    total: { value: "141,600", confidence: 0.95, page: 1 },
    tax_rate: { value: "18%", confidence: 0.92, page: 1 },
  },
  line_items: [
    { description: "A4 paper", quantity: "4", unit_price: "18,000", line_total: "72,000", tax_rate: "18", page: 1, confidence: 0.9 },
  ],
});

Deno.test("buildExtractionRecordPayload: normalises fields to typed rows", () => {
  const payload = buildExtractionRecordPayload({
    billDocumentId: "d1",
    workspaceId: "w1",
    call: call(GOOD),
  }) as Record<string, unknown>;

  assertEquals(payload.status, "succeeded");
  assertEquals(payload.doc_class, "supplier_invoice");
  assertEquals(payload.provider, "mock");

  const fields = payload.fields as Array<Record<string, unknown>>;
  const byKey = Object.fromEntries(fields.map((f) => [f.field_key, f]));

  assertEquals(byKey.total.value_type, "money_minor");
  assertEquals(byKey.total.normalized_value, "141600");
  assertEquals(byKey.total.currency, "RWF");

  assertEquals(byKey.issue_date.value_type, "date");
  assertEquals(byKey.issue_date.normalized_value, "2026-08-12");

  assertEquals(byKey.currency.normalized_value, "RWF");
  assertEquals(byKey.tax_rate.value_type, "decimal");
  assertEquals(byKey.tax_rate.normalized_value, "18");

  assertEquals(byKey.supplier_name.value_type, "string");
  assertEquals(byKey.supplier_name.normalized_value, "Kigali Office Supplies Ltd");

  const lines = payload.line_items as Array<Record<string, unknown>>;
  assertEquals(lines.length, 1);
  assertEquals(lines[0].unit_price_minor, "18000");
  assertEquals(lines[0].line_total_minor, "72000");
  assertEquals(lines[0].currency, "RWF");
  assertEquals(lines[0].line_index, 0);
});

Deno.test("buildExtractionRecordPayload: null call -> failed payload, no throw", () => {
  const payload = buildExtractionRecordPayload({
    billDocumentId: "d1",
    workspaceId: "w1",
    call: null,
  }) as Record<string, unknown>;
  assertEquals(payload.status, "failed");
  assertEquals((payload.error as { kind: string }).kind, "provider_unavailable");
});

Deno.test("buildExtractionRecordPayload: unparseable response -> failed payload", () => {
  const payload = buildExtractionRecordPayload({
    billDocumentId: "d1",
    workspaceId: "w1",
    call: call("this is not json"),
  }) as Record<string, unknown>;
  assertEquals(payload.status, "failed");
  assertEquals((payload.error as { kind: string }).kind, "invalid_response");
});

Deno.test("buildExtractionRecordPayload: money field with no doc currency normalises to null, keeps raw", () => {
  const raw = JSON.stringify({
    doc_class: "receipt",
    fields: { total: { value: "1,200", confidence: 0.9, page: 1 } },
    line_items: [],
  });
  const payload = buildExtractionRecordPayload({
    billDocumentId: "d1",
    workspaceId: "w1",
    call: call(raw),
  }) as Record<string, unknown>;
  const total = (payload.fields as Array<Record<string, unknown>>)[0];
  assertEquals(total.normalized_value, null);
  assertEquals(total.raw_value, "1,200");
  assert(payload.status === "succeeded");
});
