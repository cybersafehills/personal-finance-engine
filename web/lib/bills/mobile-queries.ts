import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { isBillStatus, type BillStatus } from "./display";
import type {
  BillDetailRow,
  BillEventRow,
  BillFieldRow,
  BillFindingRow,
  BillLineItemInput,
  BillListRow,
} from "../mobile-bills";

// Strict reads for the mobile Bills routes. Unlike lib/bills/queries.ts (whose
// readers swallow errors into [] for the web page), these THROW on a failed
// read, so the app gets a retryable error and never an empty list that reads as
// "no documents". They are also scoped to ONE Space explicitly: RLS for
// bill_documents is plain membership, so without the filter a document from any
// of the caller's Spaces would open under the active Space's feature gate and
// permissions.

export const MOBILE_BILLS_PAGE = 50;

export type BillListFilter = BillStatus | "all";

export function parseBillStatusFilter(raw: string | null): BillListFilter | null {
  if (raw === null || raw === "" || raw === "all") return "all";
  return isBillStatus(raw) ? raw : null;
}

export async function getMobileBillList(
  workspaceId: string,
  status: BillListFilter,
): Promise<{ rows: BillListRow[]; hasMore: boolean }> {
  const supabase = await supabaseSession();
  let query = supabase
    .from("bill_documents")
    .select("id, status, sanitized_filename, uploaded_at, page_count")
    .eq("workspace_id", workspaceId)
    .order("uploaded_at", { ascending: false })
    .limit(MOBILE_BILLS_PAGE + 1);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`bill list read failed: ${error.message}`);
  const rows = (data ?? []) as BillListRow[];
  return { rows: rows.slice(0, MOBILE_BILLS_PAGE), hasMore: rows.length > MOBILE_BILLS_PAGE };
}

export type MobileBillBundle = {
  doc: BillDetailRow;
  extraction: { fields: BillFieldRow[]; lineItems: BillLineItemInput[] } | null;
  checks: { blockingCount: number; outOfDate: boolean; findings: BillFindingRow[] } | null;
  events: BillEventRow[] | null;
  /** May this member open the original file? (bill.download_original) */
  canViewOriginal: boolean;
};

const SEVERITY_ORDER: Record<string, number> = {
  blocking: 0,
  needs_specialist: 1,
  possible_duplicate: 2,
  warning: 3,
  info: 4,
};

/** One document in one Space, or null when it is not in that Space (or not visible). */
export async function getMobileBillBundle(
  id: string,
  workspaceId: string,
  opts: { extractionEnabled: boolean },
): Promise<MobileBillBundle | null> {
  const supabase = await supabaseSession();

  const { data: doc, error } = await supabase
    .from("bill_documents")
    .select("id, status, sanitized_filename, uploaded_at, page_count, mime_type, byte_size, review_revision")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`bill read failed: ${error.message}`);
  if (!doc) return null;

  // The processing history is its own capability; RLS would return an empty
  // list for a member without it, which must read as "no permission", not
  // "no history".
  const has = async (capability: string): Promise<boolean> => {
    const { data, error: capError } = await supabase.rpc("has_space_capability", {
      p_workspace_id: workspaceId,
      p_capability: capability,
    });
    if (capError) throw new Error(`bill capability read failed: ${capError.message}`);
    return data === true;
  };
  const [canAudit, canViewOriginal] = await Promise.all([
    has("bill.audit.view"),
    has("bill.download_original"),
  ]);

  let events: BillEventRow[] | null = null;
  if (canAudit) {
    const { data, error: eventsError } = await supabase
      .from("bill_processing_events")
      .select("id, actor_type, event_type, previous_state, new_state, outcome, created_at")
      .eq("bill_document_id", id)
      .order("created_at", { ascending: true });
    if (eventsError) throw new Error(`bill history read failed: ${eventsError.message}`);
    events = (data ?? []) as BillEventRow[];
  }

  let extraction: MobileBillBundle["extraction"] = null;
  let checks: MobileBillBundle["checks"] = null;

  if (opts.extractionEnabled) {
    const { data: current, error: extractionError } = await supabase
      .from("bill_extractions")
      .select("id")
      .eq("bill_document_id", id)
      .eq("is_current", true)
      .maybeSingle();
    if (extractionError) throw new Error(`bill extraction read failed: ${extractionError.message}`);

    if (current) {
      const [fields, lineItems] = await Promise.all([
        supabase
          .from("bill_extracted_fields")
          .select("field_key, value_type, raw_value, normalized_value, currency, user_corrected_value")
          .eq("extraction_id", current.id)
          .order("field_key", { ascending: true }),
        supabase
          .from("bill_line_items")
          .select("line_index, description, quantity, line_total_minor, currency")
          .eq("extraction_id", current.id)
          .order("line_index", { ascending: true }),
      ]);
      if (fields.error) throw new Error(`bill fields read failed: ${fields.error.message}`);
      if (lineItems.error) throw new Error(`bill line items read failed: ${lineItems.error.message}`);
      extraction = {
        fields: (fields.data ?? []) as BillFieldRow[],
        lineItems: (lineItems.data ?? []) as BillLineItemInput[],
      };
    }

    const { data: validation, error: validationError } = await supabase
      .from("bill_validations")
      .select("id, blocking_count, review_revision")
      .eq("bill_document_id", id)
      .eq("is_current", true)
      .maybeSingle();
    if (validationError) throw new Error(`bill checks read failed: ${validationError.message}`);

    if (validation) {
      const { data: findings, error: findingsError } = await supabase
        .from("bill_validation_findings")
        .select("id, severity, title, detail, suggested_action")
        .eq("validation_id", validation.id);
      if (findingsError) throw new Error(`bill findings read failed: ${findingsError.message}`);
      const sorted = ((findings ?? []) as BillFindingRow[]).sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
      );
      checks = {
        blockingCount: Number(validation.blocking_count),
        outOfDate: Number(validation.review_revision) !== Number(doc.review_revision),
        findings: sorted,
      };
    }
  }

  return {
    doc: doc as unknown as BillDetailRow,
    extraction,
    checks,
    events,
    canViewOriginal,
  };
}
