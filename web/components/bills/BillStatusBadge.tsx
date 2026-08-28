import { Badge } from "../Badge";
import type { BillDocumentStatus } from "../../lib/bills/queries";

// Label + variant per lifecycle state. The label is always shown, so the
// status is never communicated by colour alone (master prompt §20/§22).

const STATUS_DISPLAY: Record<
  BillDocumentStatus,
  { label: string; variant: "accent" | "neutral" | "attention" | "positive" }
> = {
  uploading: { label: "Uploading", variant: "neutral" },
  received: { label: "Received", variant: "neutral" },
  stored: { label: "Stored", variant: "neutral" },
  queued: { label: "Queued", variant: "neutral" },
  scanning: { label: "Scanning", variant: "neutral" },
  classifying: { label: "Classifying", variant: "neutral" },
  extracting: { label: "Extracting", variant: "neutral" },
  validating: { label: "Validating", variant: "neutral" },
  needs_review: { label: "Needs review", variant: "accent" },
  under_review: { label: "Under review", variant: "accent" },
  awaiting_clarification: { label: "Awaiting clarification", variant: "attention" },
  approved: { label: "Approved", variant: "positive" },
  rejected: { label: "Rejected", variant: "attention" },
  posting: { label: "Posting", variant: "neutral" },
  posted: { label: "Posted", variant: "positive" },
  matched: { label: "Matched", variant: "positive" },
  processing_failed: { label: "Processing failed", variant: "attention" },
  archived: { label: "Archived", variant: "neutral" },
};

export function BillStatusBadge({ status }: { status: BillDocumentStatus }) {
  const display = STATUS_DISPLAY[status] ?? { label: status, variant: "neutral" as const };
  return <Badge variant={display.variant}>{display.label}</Badge>;
}
