import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { getActiveWorkspaceId } from "../queries";

// Read side of the Bills & Expenses surface. Every query goes through the
// session-authenticated Supabase client - RLS (bill_documents_select_member,
// bill_processing_events_select_auditor) is the security boundary, so there
// is deliberately no manual `.eq("workspace_id", ...)` here, matching the
// house rule in lib/queries.ts. A signed-out or non-member caller simply
// gets nothing, never an error that leaks existence.

export type BillDocumentStatus =
  | "uploading"
  | "received"
  | "stored"
  | "queued"
  | "scanning"
  | "classifying"
  | "extracting"
  | "validating"
  | "needs_review"
  | "under_review"
  | "awaiting_clarification"
  | "approved"
  | "rejected"
  | "posting"
  | "posted"
  | "matched"
  | "processing_failed"
  | "archived";

export type BillDocumentRow = {
  id: string;
  workspace_id: string;
  status: BillDocumentStatus;
  doc_class: string | null;
  intake_channel: string;
  original_filename: string;
  sanitized_filename: string;
  mime_type: string;
  byte_size: number;
  page_count: number | null;
  checksum_sha256: string;
  security_scan_status: string;
  retention_status: string;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
};

const BILL_DOCUMENT_COLUMNS =
  "id, workspace_id, status, doc_class, intake_channel, original_filename, sanitized_filename, mime_type, byte_size, page_count, checksum_sha256, security_scan_status, retention_status, uploaded_at, created_at, updated_at";

export type BillProcessingEventRow = {
  id: string;
  bill_document_id: string;
  actor_type: "user" | "system" | "provider" | "cron";
  actor_user_id: string | null;
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
  outcome: string | null;
  reason: Record<string, unknown> | null;
  provider: string | null;
  model_version: string | null;
  created_at: string;
};

const BILL_EVENT_COLUMNS =
  "id, bill_document_id, actor_type, actor_user_id, event_type, previous_state, new_state, outcome, reason, provider, model_version, created_at";

export type BillDocumentFilters = {
  status?: BillDocumentStatus | "all";
  limit?: number;
};

export async function getBillDocuments(
  filters: BillDocumentFilters = {},
): Promise<BillDocumentRow[]> {
  const supabase = await supabaseSession();
  let query = supabase
    .from("bill_documents")
    .select(BILL_DOCUMENT_COLUMNS)
    .order("uploaded_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("getBillDocuments failed:", error.message);
    return [];
  }
  return (data ?? []) as BillDocumentRow[];
}

export async function getBillDocumentById(
  id: string,
): Promise<BillDocumentRow | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("bill_documents")
    .select(BILL_DOCUMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getBillDocumentById failed:", error.message);
    return null;
  }
  return (data as BillDocumentRow | null) ?? null;
}

export async function getBillProcessingEvents(
  billDocumentId: string,
): Promise<BillProcessingEventRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("bill_processing_events")
    .select(BILL_EVENT_COLUMNS)
    .eq("bill_document_id", billDocumentId)
    .order("created_at", { ascending: true });

  if (error) {
    // A member without bill.audit.view sees an RLS-empty result, not an
    // error - but a genuine failure is still logged.
    if (error.code !== "PGRST116") {
      console.error("getBillProcessingEvents failed:", error.message);
    }
    return [];
  }
  return (data ?? []) as BillProcessingEventRow[];
}

export type BillPermissions = {
  canUpload: boolean;
  canReview: boolean;
  canApprove: boolean;
  canPost: boolean;
  canDownloadOriginal: boolean;
  canViewAudit: boolean;
  canManage: boolean;
};

const NO_PERMISSIONS: BillPermissions = {
  canUpload: false,
  canReview: false,
  canApprove: false,
  canPost: false,
  canDownloadOriginal: false,
  canViewAudit: false,
  canManage: false,
};

/** The caller's Bills capabilities in a workspace, resolved through the
 *  has_space_capability RPC (granted to authenticated). Used only to
 *  decide which controls to render - the RPCs and API routes re-check
 *  server-side regardless. */
export async function getBillPermissions(
  workspaceId: string | null,
): Promise<BillPermissions> {
  if (!workspaceId) return NO_PERMISSIONS;
  const supabase = await supabaseSession();

  async function has(capability: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("has_space_capability", {
      p_workspace_id: workspaceId,
      p_capability: capability,
    });
    if (error) {
      console.error(`has_space_capability(${capability}) failed:`, error.message);
      return false;
    }
    return data === true;
  }

  const [
    canUpload,
    canReview,
    canApprove,
    canPost,
    canDownloadOriginal,
    canViewAudit,
    canManage,
  ] = await Promise.all([
    has("bill.upload"),
    has("bill.review"),
    has("bill.approve"),
    has("bill.post"),
    has("bill.download_original"),
    has("bill.audit.view"),
    has("bill.manage"),
  ]);

  return {
    canUpload,
    canReview,
    canApprove,
    canPost,
    canDownloadOriginal,
    canViewAudit,
    canManage,
  };
}

/** Convenience for pages: the active workspace id + the caller's bill
 *  permissions in it, in one call. */
export async function getActiveBillContext(): Promise<{
  workspaceId: string | null;
  permissions: BillPermissions;
}> {
  const workspaceId = await getActiveWorkspaceId();
  const permissions = await getBillPermissions(workspaceId);
  return { workspaceId, permissions };
}

// --- Phase 2: extraction read side ----------------------------------

export type BillExtractionRow = {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  doc_class: string | null;
  doc_class_confidence: number | null;
  provider: string | null;
  model: string | null;
  ruleset_version: string;
  error: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
};

export type BillExtractedFieldRow = {
  id: string;
  field_key: string;
  value_type: "string" | "date" | "money_minor" | "decimal" | "integer";
  raw_value: string | null;
  normalized_value: string | null;
  currency: string | null;
  confidence: number | null;
  source_page: number | null;
  user_corrected_value: string | null;
};

export type BillLineItemRow = {
  id: string;
  line_index: number;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price_minor: number | null;
  currency: string | null;
  tax_rate: number | null;
  line_total_minor: number | null;
  confidence: number | null;
};

export type BillExtractionBundle = {
  extraction: BillExtractionRow | null;
  fields: BillExtractedFieldRow[];
  lineItems: BillLineItemRow[];
};

export async function getCurrentBillExtraction(
  billDocumentId: string,
): Promise<BillExtractionBundle> {
  const supabase = await supabaseSession();

  const { data: extraction, error } = await supabase
    .from("bill_extractions")
    .select(
      "id, status, doc_class, doc_class_confidence, provider, model, ruleset_version, error, completed_at, created_at",
    )
    .eq("bill_document_id", billDocumentId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) {
    console.error("getCurrentBillExtraction failed:", error.message);
    return { extraction: null, fields: [], lineItems: [] };
  }
  if (!extraction) return { extraction: null, fields: [], lineItems: [] };

  const [{ data: fields }, { data: lineItems }] = await Promise.all([
    supabase
      .from("bill_extracted_fields")
      .select(
        "id, field_key, value_type, raw_value, normalized_value, currency, confidence, source_page, user_corrected_value",
      )
      .eq("extraction_id", extraction.id)
      .order("field_key", { ascending: true }),
    supabase
      .from("bill_line_items")
      .select(
        "id, line_index, description, quantity, unit, unit_price_minor, currency, tax_rate, line_total_minor, confidence",
      )
      .eq("extraction_id", extraction.id)
      .order("line_index", { ascending: true }),
  ]);

  return {
    extraction: extraction as BillExtractionRow,
    fields: (fields ?? []) as BillExtractedFieldRow[],
    lineItems: (lineItems ?? []) as BillLineItemRow[],
  };
}

// --- Phase 3: validation read side ---------------------------------

export type BillValidationRow = {
  id: string;
  status: "succeeded" | "failed";
  ruleset_version: string;
  blocking_count: number;
  warning_count: number;
  info_count: number;
  error: Record<string, unknown> | null;
  created_at: string;
};

export type BillValidationFindingRow = {
  id: string;
  rule_id: string;
  severity: "info" | "warning" | "blocking" | "possible_duplicate" | "needs_specialist";
  title: string;
  detail: string;
  affected_fields: string[];
  blocks_approval: boolean;
  suggested_action: string | null;
};

export type BillValidationBundle = {
  validation: BillValidationRow | null;
  findings: BillValidationFindingRow[];
};

const SEVERITY_ORDER: Record<string, number> = {
  blocking: 0,
  needs_specialist: 1,
  possible_duplicate: 2,
  warning: 3,
  info: 4,
};

export async function getCurrentBillValidation(
  billDocumentId: string,
): Promise<BillValidationBundle> {
  const supabase = await supabaseSession();

  const { data: validation, error } = await supabase
    .from("bill_validations")
    .select(
      "id, status, ruleset_version, blocking_count, warning_count, info_count, error, created_at",
    )
    .eq("bill_document_id", billDocumentId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) {
    console.error("getCurrentBillValidation failed:", error.message);
    return { validation: null, findings: [] };
  }
  if (!validation) return { validation: null, findings: [] };

  const { data: findings } = await supabase
    .from("bill_validation_findings")
    .select(
      "id, rule_id, severity, title, detail, affected_fields, blocks_approval, suggested_action",
    )
    .eq("validation_id", validation.id);

  const sorted = ((findings ?? []) as BillValidationFindingRow[]).sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return { validation: validation as BillValidationRow, findings: sorted };
}
