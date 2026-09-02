// Pure types + vocabularies for the Phase 2 outbound layer
// (migration 20261101000000). No server-only import - reusable on the
// client and unit-testable.

export const DESTINATION_KINDS = [
  "download",
  "webhook",
  "cloud_storage",
  "connected_workbook",
] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DESTINATION_PROVIDERS = [
  "google_drive",
  "onedrive",
  "dropbox",
  "google_sheets",
  "excel_365",
  "custom",
] as const;
export type DestinationProvider = (typeof DESTINATION_PROVIDERS)[number];

export const DESTINATION_STATUSES = [
  "active",
  "needs_auth",
  "error",
  "disabled",
] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export const SYNC_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

export const SYNC_TRIGGERS = ["manual", "scheduled", "webhook", "poll"] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

export const SYNC_DIRECTIONS = ["export", "import", "two_way"] as const;
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

export const WORKBOOK_STATUSES = [
  "active",
  "paused",
  "needs_auth",
  "error",
  "disconnected",
] as const;
export type WorkbookStatus = (typeof WORKBOOK_STATUSES)[number];

export const CONFLICT_STATUSES = [
  "open",
  "kept_oneledger",
  "accepted_external",
  "edited",
  "ignored",
] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** The canonical OneLedger datasets a connected workbook can map to sheets. */
export const WORKBOOK_DATASETS = [
  "transactions",
  "income",
  "expenses",
  "categories",
  "accounts",
] as const;
export type WorkbookDataset = (typeof WORKBOOK_DATASETS)[number];

export type IntegrationDestination = {
  id: string;
  workspaceId: string;
  name: string;
  kind: DestinationKind;
  provider: DestinationProvider | null;
  config: Record<string, unknown>;
  status: DestinationStatus;
  lastDeliveryAt: string | null;
  lastErrorCode: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConnectedWorkbook = {
  id: string;
  workspaceId: string;
  destinationId: string;
  externalRef: string | null;
  sheetMap: Partial<Record<WorkbookDataset, string>>;
  direction: SyncDirection;
  sourceOfTruth: "oneledger" | "external";
  lastSyncRunId: string | null;
  status: WorkbookStatus;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationSyncRun = {
  id: string;
  workspaceId: string;
  destinationId: string | null;
  connectedWorkbookId: string | null;
  exportJobId: string | null;
  trigger: SyncTrigger;
  direction: SyncDirection;
  status: SyncRunStatus;
  cursorBefore: string | null;
  cursorAfter: string | null;
  counts: Record<string, number>;
  error: Record<string, unknown> | null;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type IntegrationConflict = {
  id: string;
  workspaceId: string;
  syncRunId: string | null;
  connectedWorkbookId: string | null;
  refType: string;
  refId: string | null;
  field: string | null;
  oneledgerValue: unknown;
  externalValue: unknown;
  status: ConflictStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

/** A destination whose delivery mechanism works without any OAuth provider. */
export function isSelfContainedDestination(kind: DestinationKind): boolean {
  return kind === "download" || kind === "webhook";
}

/** True once a sync run has reached a terminal state. */
export function isSyncRunFinished(status: SyncRunStatus): boolean {
  return status === "succeeded" || status === "partial" || status === "failed";
}
