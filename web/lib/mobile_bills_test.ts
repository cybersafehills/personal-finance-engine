import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  formatBytes,
  toMobileBillDetail,
  toMobileBillFields,
  toMobileBillLineItems,
  toMobileBillListItem,
} from "./mobile-bills.ts";
import { billEventLabel, billStatusDisplay, isBillStatus } from "./bills/display.ts";

const DOC = {
  id: "d1",
  status: "needs_review",
  sanitized_filename: "acme-4471.pdf",
  uploaded_at: "2026-08-23T22:30:00Z",
  page_count: 2,
  mime_type: "application/pdf",
  byte_size: 2048,
};

Deno.test("list item: status wording and a Kigali-time date from the server", () => {
  const item = toMobileBillListItem(DOC);
  assertEquals(item.statusLabel, "Needs review");
  assertEquals(item.tone, "accent");
  assertEquals(item.filename, "acme-4471.pdf");
  // 22:30 UTC on 23 Aug is 00:30 on 24 Aug in Kigali (UTC+2).
  assertMatch(item.uploadedLabel, /August 24, 2026/);
});

Deno.test("an unknown status is shown as-is, neutral, never dropped", () => {
  assertEquals(billStatusDisplay("brand_new"), { label: "brand_new", tone: "neutral" });
  assertEquals(isBillStatus("posted"), true);
  assertEquals(isBillStatus("nope"), false);
});

Deno.test("fields: corrected beats normalized beats raw; money and tax rate are rendered", () => {
  const out = toMobileBillFields([
    { field_key: "total", value_type: "money_minor", raw_value: "x", normalized_value: "12550", currency: "USD", user_corrected_value: null },
    { field_key: "total", value_type: "money_minor", raw_value: "x", normalized_value: "12550", currency: "USD", user_corrected_value: "20000" },
    { field_key: "subtotal", value_type: "money_minor", raw_value: null, normalized_value: "5000", currency: "RWF", user_corrected_value: null },
    { field_key: "tax_rate", value_type: "decimal", raw_value: "18", normalized_value: null, currency: null, user_corrected_value: null },
    { field_key: "invoice_number", value_type: "string", raw_value: null, normalized_value: null, currency: null, user_corrected_value: null },
  ]);
  assertEquals(out.map((f) => [f.label, f.value]), [
    ["Total", "USD 125.50"],
    ["Total", "USD 200.00"],
    ["Subtotal", "RWF 5,000"],
    ["Tax rate", "18%"],
  ]);
});

Deno.test("line items are ordered and formatted", () => {
  const out = toMobileBillLineItems([
    { line_index: 2, description: null, quantity: null, line_total_minor: null, currency: "RWF" },
    { line_index: 1, description: " Cement ", quantity: 3, line_total_minor: 9000, currency: "RWF" },
  ]);
  assertEquals(out, [
    { description: "Cement", quantityLabel: "3", totalLabel: "RWF 9,000" },
    { description: "Item", quantityLabel: null, totalLabel: "—" },
  ]);
});

Deno.test("history: null means no permission, an empty list means no events", () => {
  const base = { doc: DOC, extraction: null, checks: null, canViewOriginal: false };
  assertEquals(toMobileBillDetail({ ...base, events: null }).history, null);
  assertEquals(toMobileBillDetail({ ...base, events: [] }).history, []);
  const withEvent = toMobileBillDetail({
    ...base,
    events: [{ id: "e1", actor_type: "cron", event_type: "status_changed", previous_state: "stored", new_state: "queued", outcome: "ok", created_at: DOC.uploaded_at }],
  });
  assertEquals(withEvent.history?.[0].label, "Status: stored → queued");
  assertEquals(withEvent.history?.[0].byLabel, "A scheduled job");
});

Deno.test("detail carries no raw provider data", () => {
  const detail = toMobileBillDetail({
    doc: { ...DOC, checksum_sha256: "abc", provider: "p" } as typeof DOC,
    extraction: null,
    checks: { blockingCount: 1, outOfDate: true, findings: [{ id: "f", severity: "blocking", title: "t", detail: "d", suggested_action: null }] },
    events: null,
    canViewOriginal: true,
  });
  const text = JSON.stringify(detail);
  assertEquals(text.includes("abc"), false);
  assertEquals(detail.checks?.outOfDate, true);
  assertEquals(detail.checks?.findings[0].severityLabel, "Must fix");
  assertEquals(detail.typeLabel, "PDF");
  assertEquals(detail.sizeLabel, "2.0 KB");
});

Deno.test("event label falls back to a readable phrase", () => {
  assertEquals(billEventLabel({ event_type: "some_new_event", previous_state: null, new_state: null }), "some new event");
  assertEquals(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

Deno.test("detail says whether the original may be opened", () => {
  const base = { doc: DOC, extraction: null, checks: null, events: null };
  assertEquals(toMobileBillDetail({ ...base, canViewOriginal: true }).canViewOriginal, true);
  assertEquals(toMobileBillDetail({ ...base, canViewOriginal: false }).canViewOriginal, false);
});
