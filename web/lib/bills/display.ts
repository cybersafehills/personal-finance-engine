// Pure wording for the Bills & Expenses surface, shared by the web components
// (BillStatusBadge, BillProcessingTimeline, BillFieldsEditor) and the mobile API
// (lib/mobile-bills.ts), so the two never describe the same document differently.
// No framework or server-only imports: Deno-testable.

export const BILL_STATUSES = [
  "uploading",
  "received",
  "stored",
  "queued",
  "scanning",
  "classifying",
  "extracting",
  "validating",
  "needs_review",
  "under_review",
  "awaiting_clarification",
  "approved",
  "rejected",
  "posting",
  "posted",
  "matched",
  "processing_failed",
  "archived",
] as const;

export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillTone = "accent" | "neutral" | "attention" | "positive";

// Label + tone per lifecycle state. The label is always shown, so the status is
// never communicated by colour alone.
export const BILL_STATUS_DISPLAY: Record<BillStatus, { label: string; tone: BillTone }> = {
  uploading: { label: "Uploading", tone: "neutral" },
  received: { label: "Received", tone: "neutral" },
  stored: { label: "Stored", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  scanning: { label: "Scanning", tone: "neutral" },
  classifying: { label: "Classifying", tone: "neutral" },
  extracting: { label: "Extracting", tone: "neutral" },
  validating: { label: "Validating", tone: "neutral" },
  needs_review: { label: "Needs review", tone: "accent" },
  under_review: { label: "Under review", tone: "accent" },
  awaiting_clarification: { label: "Awaiting clarification", tone: "attention" },
  approved: { label: "Approved", tone: "positive" },
  rejected: { label: "Rejected", tone: "attention" },
  posting: { label: "Posting", tone: "neutral" },
  posted: { label: "Posted", tone: "positive" },
  matched: { label: "Matched", tone: "positive" },
  processing_failed: { label: "Processing failed", tone: "attention" },
  archived: { label: "Archived", tone: "neutral" },
};

export function isBillStatus(value: string): value is BillStatus {
  return (BILL_STATUSES as readonly string[]).includes(value);
}

export function billStatusDisplay(status: string): { label: string; tone: BillTone } {
  return isBillStatus(status)
    ? BILL_STATUS_DISPLAY[status]
    : { label: status, tone: "neutral" };
}

const EVENT_LABEL: Record<string, string> = {
  document_received: "Document received and original stored",
  original_stored: "Original stored",
  status_changed: "Status changed",
  original_downloaded: "Original downloaded",
  document_archived: "Document archived",
  processing_retried: "Processing retried",
  processing_failed: "Processing failed",
};

export function billEventLabel(event: {
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
}): string {
  if (event.event_type === "status_changed" && event.previous_state && event.new_state) {
    return `Status: ${event.previous_state} → ${event.new_state}`;
  }
  return EVENT_LABEL[event.event_type] ?? event.event_type.replace(/_/g, " ");
}

export function billActorLabel(actorType: string): string {
  switch (actorType) {
    case "user":
      return "A person";
    case "system":
      return "The system";
    case "provider":
      return "The extraction provider";
    case "cron":
      return "A scheduled job";
    default:
      return "The system";
  }
}

export const BILL_FIELD_LABELS: Record<string, string> = {
  supplier_name: "Supplier",
  supplier_tax_id: "Tax ID",
  supplier_address: "Address",
  supplier_email: "Email",
  supplier_phone: "Phone",
  supplier_bank_details: "Bank details",
  invoice_number: "Invoice no.",
  receipt_number: "Receipt no.",
  credit_note_number: "Credit note no.",
  purchase_order_reference: "PO reference",
  payment_reference: "Payment reference",
  issue_date: "Issue date",
  receipt_date: "Receipt date",
  due_date: "Due date",
  payment_date: "Payment date",
  service_period_start: "Service from",
  service_period_end: "Service to",
  currency: "Currency",
  subtotal: "Subtotal",
  tax_amount: "Tax",
  tax_rate: "Tax rate",
  discount_amount: "Discount",
  additional_charges: "Charges",
  total: "Total",
  amount_paid: "Amount paid",
  outstanding_balance: "Balance due",
};
