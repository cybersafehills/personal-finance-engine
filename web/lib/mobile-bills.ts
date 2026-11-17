// The Bills & Expenses payloads for the mobile app (GET /api/mobile/bills and
// /api/mobile/bills/:id). Pure: reshapes stored rows into plain JSON.
//
// The app only displays. Every status label, sentence, amount and date is
// rendered here with the web's own wording (lib/bills/display.ts), so the two
// surfaces never describe a document differently and the phone never formats a
// date or an amount with an engine that may lack Intl support. Raw provider
// payloads (`reason`, `error`, `provider`, `model_version`, checksums) are
// deliberately not passed on.

import {
  BILL_FIELD_LABELS,
  billActorLabel,
  billEventLabel,
  billStatusDisplay,
  type BillTone,
} from "./bills/display.ts";
import { currencyMinorDigits } from "./bills/normalize.ts";
import { formatFullDateTime } from "./format.ts";

export type BillListRow = {
  id: string;
  status: string;
  sanitized_filename: string;
  uploaded_at: string;
  page_count: number | null;
};

export type MobileBillListItem = {
  id: string;
  filename: string;
  status: string;
  statusLabel: string;
  tone: BillTone;
  uploadedLabel: string;
  pageCount: number | null;
};

export function toMobileBillListItem(row: BillListRow): MobileBillListItem {
  const display = billStatusDisplay(row.status);
  return {
    id: row.id,
    filename: row.sanitized_filename,
    status: row.status,
    statusLabel: display.label,
    tone: display.tone,
    uploadedLabel: formatFullDateTime(row.uploaded_at),
    pageCount: row.page_count,
  };
}

export type BillDetailRow = BillListRow & {
  mime_type: string;
  byte_size: number;
};

export type BillFieldRow = {
  field_key: string;
  value_type: string;
  raw_value: string | null;
  normalized_value: string | null;
  currency: string | null;
  user_corrected_value: string | null;
};

export type BillLineItemInput = {
  line_index: number;
  description: string | null;
  quantity: number | null;
  line_total_minor: number | null;
  currency: string | null;
};

export type BillFindingRow = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  suggested_action: string | null;
};

export type BillEventRow = {
  id: string;
  actor_type: string;
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
  outcome: string | null;
  created_at: string;
};

export type MobileBillField = { key: string; label: string; value: string };
export type MobileBillLineItem = { description: string; quantityLabel: string | null; totalLabel: string };
export type MobileBillFinding = {
  id: string;
  severity: string;
  severityLabel: string;
  title: string;
  detail: string;
  suggestedAction: string | null;
};
export type MobileBillEvent = { id: string; label: string; byLabel: string; whenLabel: string };

export type MobileBillDetail = MobileBillListItem & {
  typeLabel: string;
  sizeLabel: string;
  /** Null when automated extraction is off for this Space. */
  extraction: { fields: MobileBillField[]; lineItems: MobileBillLineItem[] } | null;
  /** Null when extraction is off or no checks have run. `outOfDate`: a field was corrected after the checks ran. */
  checks: { blocking: number; outOfDate: boolean; findings: MobileBillFinding[] } | null;
  /** Null when the caller lacks permission to see the processing history. */
  history: MobileBillEvent[] | null;
};

const MIME_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/heic": "HEIC image",
  "image/heif": "HEIF image",
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function moneyLabel(minor: number, currency: string | null): string {
  const digits = currency ? currencyMinorDigits(currency) : 2;
  const amount = (minor / 10 ** digits).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${currency ? currency + " " : ""}${amount}`;
}

function fieldValue(f: BillFieldRow): string | null {
  const v = f.user_corrected_value ?? f.normalized_value ?? f.raw_value;
  if (v === null || v === "") return null;
  if (f.value_type === "money_minor" && /^-?\d+$/.test(v)) return moneyLabel(Number(v), f.currency);
  if (f.field_key === "tax_rate") return `${v}%`;
  return v;
}

export function toMobileBillFields(rows: BillFieldRow[]): MobileBillField[] {
  const out: MobileBillField[] = [];
  for (const f of rows) {
    const value = fieldValue(f);
    if (value === null) continue;
    out.push({
      key: f.field_key,
      label: BILL_FIELD_LABELS[f.field_key] ?? f.field_key.replace(/_/g, " "),
      value,
    });
  }
  return out;
}

export function toMobileBillLineItems(rows: BillLineItemInput[]): MobileBillLineItem[] {
  return [...rows]
    .sort((a, b) => a.line_index - b.line_index)
    .map((li) => ({
      description: li.description?.trim() || "Item",
      quantityLabel: li.quantity === null ? null : String(li.quantity),
      totalLabel: li.line_total_minor === null ? "—" : moneyLabel(li.line_total_minor, li.currency),
    }));
}

const SEVERITY_LABEL: Record<string, string> = {
  blocking: "Must fix",
  needs_specialist: "Needs a specialist",
  possible_duplicate: "Possible duplicate",
  warning: "Warning",
  info: "Note",
};

export function toMobileBillFindings(rows: BillFindingRow[]): MobileBillFinding[] {
  return rows.map((r) => ({
    id: r.id,
    severity: r.severity,
    severityLabel: SEVERITY_LABEL[r.severity] ?? r.severity,
    title: r.title,
    detail: r.detail,
    suggestedAction: r.suggested_action,
  }));
}

export function toMobileBillEvents(rows: BillEventRow[]): MobileBillEvent[] {
  return rows.map((e) => ({
    id: e.id,
    label: billEventLabel(e),
    byLabel: billActorLabel(e.actor_type),
    whenLabel: formatFullDateTime(e.created_at),
  }));
}

export function toMobileBillDetail(input: {
  doc: BillDetailRow;
  extraction: { fields: BillFieldRow[]; lineItems: BillLineItemInput[] } | null;
  checks: { blockingCount: number; outOfDate: boolean; findings: BillFindingRow[] } | null;
  events: BillEventRow[] | null;
}): MobileBillDetail {
  const { doc } = input;
  return {
    ...toMobileBillListItem(doc),
    typeLabel: MIME_LABEL[doc.mime_type] ?? doc.mime_type,
    sizeLabel: formatBytes(doc.byte_size),
    extraction: input.extraction
      ? {
          fields: toMobileBillFields(input.extraction.fields),
          lineItems: toMobileBillLineItems(input.extraction.lineItems),
        }
      : null,
    checks: input.checks
      ? {
          blocking: input.checks.blockingCount,
          outOfDate: input.checks.outOfDate,
          findings: toMobileBillFindings(input.checks.findings),
        }
      : null,
    history: input.events ? toMobileBillEvents(input.events) : null,
  };
}
