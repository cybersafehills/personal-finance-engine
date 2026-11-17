// The Bills & Expenses payloads from GET /api/mobile/bills[/:id]. Every status
// label, sentence, amount and date is rendered by the server with the web's own
// wording (web/lib/mobile-bills.ts): the app only displays them.

export type BillTone = "accent" | "neutral" | "attention" | "positive";

export type BillListItem = {
  id: string;
  filename: string;
  status: string;
  statusLabel: string;
  tone: BillTone;
  uploadedLabel: string;
  pageCount: number | null;
};

export type BillField = { key: string; label: string; value: string };
export type BillLineItem = { description: string; quantityLabel: string | null; totalLabel: string };
export type BillFinding = {
  id: string;
  severity: string;
  severityLabel: string;
  title: string;
  detail: string;
  suggestedAction: string | null;
};
export type BillEvent = { id: string; label: string; byLabel: string; whenLabel: string };

export type BillDetail = BillListItem & {
  typeLabel: string;
  sizeLabel: string;
  /** Null when automated extraction is off for this Space. */
  extraction: { fields: BillField[]; lineItems: BillLineItem[] } | null;
  /** Null when extraction is off or no checks have run. `outOfDate`: a field was corrected after they ran. */
  checks: { blocking: number; outOfDate: boolean; findings: BillFinding[] } | null;
  /** Null when the member may not see the processing history. */
  history: BillEvent[] | null;
};
