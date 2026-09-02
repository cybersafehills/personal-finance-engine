import "server-only";

import { supabaseSession } from "../supabase-session-server";
import { getActiveWorkspaceId } from "../queries";
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
