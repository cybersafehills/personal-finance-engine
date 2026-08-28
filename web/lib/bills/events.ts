// The documented set of bill_processing_events.event_type values (master
// prompt §16). Kept in code rather than a DB CHECK so a new Phase 2+
// event type is a one-line change, not a migration - the column only
// requires non-empty text. Every value here is a coarse action label,
// never a document string.

export const BILL_EVENT_TYPES = [
  // Phase 1 - intake + lifecycle
  "document_received",
  "original_stored",
  "status_changed",
  "original_downloaded",
  "document_archived",
  "processing_retried",
  "processing_failed",
  // Phase 2+ - declared now so later workers are additive
  "security_scan_completed",
  "classification_completed",
  "extraction_started",
  "extraction_completed",
  "extraction_failed",
  "validation_completed",
  "duplicate_detected",
  "supplier_candidate_generated",
  "transaction_match_candidate_generated",
  "field_corrected",
  "review_started",
  "draft_saved",
  "clarification_requested",
  "approval_requested",
  "approved",
  "rejected",
  "posting_started",
  "ledger_record_created",
  "transaction_linked",
  "posting_failed",
  "export_generated",
] as const;

export type BillEventType = (typeof BILL_EVENT_TYPES)[number];

export type BillActorType = "user" | "system" | "provider" | "cron";
