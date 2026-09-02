import "server-only";

import { supabaseSession } from "../supabase-session-server";
import { getActiveWorkspaceId } from "../queries";
import { headerSignature, signatureSimilarity } from "./mapping";
import type {
  ExportJob,
  ExportTemplate,
  ImportBatch,
  ImportRecord,
  ImportTemplate,
  IntegrationEvent,
} from "./model";

// RLS-scoped reads for the Integrations area. The database policies
// (migration 20261027000000) already restrict every row to workspaces
// where the caller holds `integration.view`; each query additionally
// pins the active workspace so a multi-workspace user sees only the
// Space they are currently in. Kept out of the very large web/lib/queries.ts.

const BATCH_COLUMNS =
  "id, workspace_id, financial_source_id, template_id, created_by, source_kind, original_filename, storage_path, status, row_counts, detected, mapping, error, created_at, updated_at, committed_at, rolled_back_at";

const RECORD_COLUMNS =
  "id, import_batch_id, workspace_id, row_index, raw_cells, normalized, status, validation, match, canonical_transaction_id, created_at, updated_at";

const EXPORT_JOB_COLUMNS =
  "id, workspace_id, template_id, created_by, config, format, status, storage_path, row_count, error, requested_at, started_at, completed_at, created_at, updated_at";

const EVENT_COLUMNS =
  "id, workspace_id, kind, severity, ref_type, ref_id, summary, context, created_at";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toBatch(row: any): ImportBatch {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    financialSourceId: row.financial_source_id ?? null,
    templateId: row.template_id ?? null,
    createdBy: row.created_by ?? null,
    sourceKind: row.source_kind,
    originalFilename: row.original_filename,
    storagePath: row.storage_path ?? null,
    status: row.status,
    rowCounts: row.row_counts ?? {},
    detected: row.detected ?? {},
    mapping: row.mapping ?? {},
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    committedAt: row.committed_at ?? null,
    rolledBackAt: row.rolled_back_at ?? null,
  };
}

function toRecord(row: any): ImportRecord {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    workspaceId: row.workspace_id,
    rowIndex: row.row_index,
    rawCells: row.raw_cells ?? {},
    normalized: row.normalized ?? {},
    status: row.status,
    validation: row.validation ?? {},
    match: row.match ?? {},
    canonicalTransactionId: row.canonical_transaction_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toImportTemplate(row: any): ImportTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    sourceType: row.source_type,
    headerSignature: row.header_signature ?? [],
    mapping: row.mapping ?? {},
    transforms: row.transforms ?? {},
    dateFormat: row.date_format ?? null,
    decimalFormat: row.decimal_format ?? null,
    directionConvention: row.direction_convention ?? null,
    currency: row.currency ?? null,
    version: row.version,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toExportTemplate(row: any): ExportTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    config: row.config ?? {},
    format: row.format,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toExportJob(row: any): ExportJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateId: row.template_id ?? null,
    createdBy: row.created_by ?? null,
    config: row.config ?? {},
    format: row.format,
    status: row.status,
    storagePath: row.storage_path ?? null,
    rowCount: row.row_count ?? null,
    error: row.error ?? null,
    requestedAt: row.requested_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: any): IntegrationEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    severity: row.severity,
    refType: row.ref_type ?? null,
    refId: row.ref_id ?? null,
    summary: row.summary,
    context: row.context ?? {},
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listImportBatches(limit = 50): Promise<ImportBatch[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("import_batches")
    .select(BATCH_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listImportBatches failed:", error.message);
    return [];
  }
  return (data ?? []).map(toBatch);
}

/** Batches sitting in `validated` with staged rows still needing a decision. */
export async function listImportBatchesNeedingReview(): Promise<ImportBatch[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("import_batches")
    .select(BATCH_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("status", "validated")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listImportBatchesNeedingReview failed:", error.message);
    return [];
  }
  return (data ?? [])
    .map(toBatch)
    .filter(
      (b) =>
        Number(b.rowCounts.needs_review ?? 0) > 0 ||
        Number(b.rowCounts.ready ?? 0) > 0,
    );
}

export async function getImportBatch(
  id: string,
): Promise<{ batch: ImportBatch; records: ImportRecord[] } | null> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return null;
  const supabase = await supabaseSession();
  const [{ data: batchRow, error: batchError }, { data: recordRows, error: recordError }] =
    await Promise.all([
      supabase
        .from("import_batches")
        .select(BATCH_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("import_records")
        .select(RECORD_COLUMNS)
        .eq("import_batch_id", id)
        .order("row_index", { ascending: true }),
    ]);
  if (batchError || !batchRow) {
    if (batchError) console.error("getImportBatch failed:", batchError.message);
    return null;
  }
  if (recordError) {
    console.error("getImportBatch records failed:", recordError.message);
  }
  return {
    batch: toBatch(batchRow),
    records: (recordRows ?? []).map(toRecord),
  };
}

/**
 * The saved template whose header signature best matches `headers`, with
 * its similarity score (0..1). Callers decide whether the score clears
 * TEMPLATE_AUTO_APPLY_THRESHOLD before pre-filling a mapping.
 */
export async function findMatchingImportTemplate(
  headers: string[],
): Promise<{ template: ImportTemplate; score: number } | null> {
  const templates = await listImportTemplates();
  if (templates.length === 0) return null;

  const target = headerSignature(headers);
  let best: { template: ImportTemplate; score: number } | null = null;
  for (const template of templates) {
    const score = signatureSimilarity(target, template.headerSignature);
    if (!best || score > best.score) best = { template, score };
  }
  return best && best.score > 0 ? best : null;
}

export async function listImportTemplates(): Promise<ImportTemplate[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("import_templates")
    .select(
      "id, workspace_id, name, source_type, header_signature, mapping, transforms, date_format, decimal_format, direction_convention, currency, version, created_by, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) {
    console.error("listImportTemplates failed:", error.message);
    return [];
  }
  return (data ?? []).map(toImportTemplate);
}

export async function listExportJobs(limit = 50): Promise<ExportJob[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("export_jobs")
    .select(EXPORT_JOB_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listExportJobs failed:", error.message);
    return [];
  }
  return (data ?? []).map(toExportJob);
}

export async function listExportTemplates(): Promise<ExportTemplate[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("export_templates")
    .select(
      "id, workspace_id, name, config, format, created_by, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) {
    console.error("listExportTemplates failed:", error.message);
    return [];
  }
  return (data ?? []).map(toExportTemplate);
}

export type ImportTargetSource = {
  id: string;
  displayName: string;
  provider: string;
  currency: string;
};

/**
 * Financial sources the caller owns that are linked to an account - the
 * only valid commit targets for an import batch (commit_import_batch
 * resolves account_id / workspace_id from the source).
 */
export async function listImportTargetSources(): Promise<ImportTargetSource[]> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: sources, error } = await supabase
    .from("financial_sources")
    .select("id, display_name, provider, currency")
    .eq("owner_user_id", user.id)
    .order("display_name", { ascending: true });
  if (error || !sources || sources.length === 0) {
    if (error) console.error("listImportTargetSources failed:", error.message);
    return [];
  }

  const { data: accounts } = await supabase
    .from("accounts")
    .select("financial_source_id")
    .in("financial_source_id", sources.map((s) => s.id));
  const linked = new Set(
    (accounts ?? []).map((a) => a.financial_source_id as string),
  );

  return sources
    .filter((s) => linked.has(s.id))
    .map((s) => ({
      id: s.id,
      displayName: s.display_name,
      provider: s.provider,
      currency: s.currency,
    }));
}

/**
 * Existing workspace transactions in a date window, shaped for the pure
 * matching model. Used to enrich staged rows with duplicate signals
 * before commit.
 */
export async function getMatchCandidateTransactions(
  fromIso: string,
  toIso: string,
): Promise<
  {
    id: string;
    amountMinor: number;
    currency: string | null;
    direction: "in" | "out" | "neutral";
    occurredAt: string;
    counterparty: string | null;
    externalId: string | null;
    externalReference: string | null;
  }[]
> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, amount_rwf, currency, direction, occurred_at, counterparty_name, external_transaction_id, counterparty_reference",
    )
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .gte("occurred_at", fromIso)
    .lte("occurred_at", toIso)
    .limit(2000);
  if (error) {
    console.error("getMatchCandidateTransactions failed:", error.message);
    return [];
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((t: any) => ({
    id: t.id,
    amountMinor: t.amount_rwf,
    currency: t.currency,
    direction: t.direction,
    occurredAt: t.occurred_at,
    counterparty: t.counterparty_name ?? null,
    externalId: t.external_transaction_id ?? null,
    externalReference: t.counterparty_reference ?? null,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export type ExportScheduleRow = {
  id: string;
  name: string;
  cadence: "daily" | "weekly" | "monthly";
  hour: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  format: "csv" | "xlsx";
};

export async function listExportSchedules(): Promise<ExportScheduleRow[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("export_schedules")
    .select(
      "id, name, cadence, hour, day_of_week, day_of_month, timezone, enabled, last_run_at, next_run_at, config",
    )
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) {
    console.error("listExportSchedules failed:", error.message);
    return [];
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    cadence: s.cadence,
    hour: s.hour,
    dayOfWeek: s.day_of_week ?? null,
    dayOfMonth: s.day_of_month ?? null,
    timezone: s.timezone,
    enabled: s.enabled,
    lastRunAt: s.last_run_at ?? null,
    nextRunAt: s.next_run_at,
    format: (s.config?.format === "csv" ? "csv" : "xlsx") as "csv" | "xlsx",
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function listIntegrationEvents(
  limit = 50,
): Promise<IntegrationEvent[]> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("integration_events")
    .select(EVENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listIntegrationEvents failed:", error.message);
    return [];
  }
  return (data ?? []).map(toEvent);
}
