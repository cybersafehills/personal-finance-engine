// Pure types + status vocabularies for the Integrations data model
// (migration 20261027000000). No server-only import so it can be reused
// on the client and unit-tested directly.

export const IMPORT_BATCH_STATUSES = [
  "uploaded",
  "profiled",
  "mapped",
  "validated",
  "previewed",
  "committing",
  "imported",
  "failed",
  "rolled_back",
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_RECORD_STATUSES = [
  "ready",
  "needs_review",
  "needs_mapping",
  "possible_duplicate",
  "conflict",
  "invalid",
  "approved",
  "imported",
  "ignored",
  "failed",
] as const;
export type ImportRecordStatus = (typeof IMPORT_RECORD_STATUSES)[number];

export const EXPORT_JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

export const INTEGRATION_FILE_KINDS = ["csv", "xlsx"] as const;
export type IntegrationFileKind = (typeof INTEGRATION_FILE_KINDS)[number];

export const INTEGRATION_EVENT_SEVERITIES = ["info", "warning", "error"] as const;
export type IntegrationEventSeverity =
  (typeof INTEGRATION_EVENT_SEVERITIES)[number];

/** Match-confidence tiers for import_records.match (populated in PR4). */
export const MATCH_CONFIDENCE = [
  "exact",
  "likely",
  "possible",
  "distinct",
] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCE)[number];

/** Canonical target fields the column-mapping engine maps external columns onto. */
export const CANONICAL_IMPORT_FIELDS = [
  "date",
  "description",
  "merchant",
  "inflow",
  "outflow",
  "amount_signed",
  "direction",
  "balance",
  "external_reference",
  "external_transaction_id",
  "currency",
  "category",
] as const;
export type CanonicalImportField = (typeof CANONICAL_IMPORT_FIELDS)[number];

export type ImportBatchRowCounts = {
  total?: number;
  ready?: number;
  needs_review?: number;
  possible_duplicate?: number;
  invalid?: number;
  imported?: number;
  failed?: number;
  skipped?: number;
};

export type ImportBatch = {
  id: string;
  workspaceId: string;
  financialSourceId: string | null;
  templateId: string | null;
  createdBy: string | null;
  sourceKind: IntegrationFileKind;
  originalFilename: string;
  storagePath: string | null;
  status: ImportBatchStatus;
  rowCounts: ImportBatchRowCounts;
  detected: Record<string, unknown>;
  mapping: Record<string, unknown>;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  rolledBackAt: string | null;
};

export type ImportRecord = {
  id: string;
  importBatchId: string;
  workspaceId: string;
  rowIndex: number;
  rawCells: Record<string, unknown>;
  normalized: Record<string, unknown>;
  status: ImportRecordStatus;
  validation: Record<string, unknown>;
  match: Record<string, unknown>;
  canonicalTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  sourceType: string;
  headerSignature: string[];
  mapping: Record<string, unknown>;
  transforms: Record<string, unknown>;
  dateFormat: string | null;
  decimalFormat: string | null;
  directionConvention: string | null;
  currency: string | null;
  version: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExportTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  config: Record<string, unknown>;
  format: IntegrationFileKind;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExportJob = {
  id: string;
  workspaceId: string;
  templateId: string | null;
  createdBy: string | null;
  config: Record<string, unknown>;
  format: IntegrationFileKind;
  status: ExportJobStatus;
  storagePath: string | null;
  rowCount: number | null;
  error: Record<string, unknown> | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationEvent = {
  id: string;
  workspaceId: string;
  kind: string;
  severity: IntegrationEventSeverity;
  refType: string | null;
  refId: string | null;
  summary: string;
  context: Record<string, unknown>;
  createdAt: string;
};

/** True for a batch whose staging rows can still be worked on / committed. */
export function isImportBatchOpen(status: ImportBatchStatus): boolean {
  return status !== "imported" && status !== "rolled_back" && status !== "failed";
}

/** True for a staging row a commit would turn into a ledger transaction. */
export function isImportRecordCommittable(status: ImportRecordStatus): boolean {
  return status === "ready" || status === "approved";
}
