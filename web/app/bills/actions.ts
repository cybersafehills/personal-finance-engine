"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { supabaseServer } from "../../lib/supabase-server";
import { getActiveWorkspaceId } from "../../lib/queries";
import {
  assertBillsEnabled,
  billsMaxPageCount,
  billsMaxUploadBytes,
  FeatureDisabledError,
  isBillsEnabled,
  isBillsExtractionEnabled,
} from "../../lib/bills/gate";
import {
  generateStorageKey,
  rejectionMessage,
  sha256Hex,
  validateUpload,
  type SupportedMime,
} from "../../lib/bills/intake";
import { logBillError, trackBillEvent } from "../../lib/bills/analytics";
import { normalizeSupplierName } from "../../lib/bills/normalize";
import { searchSuppliers, type SupplierSearchRow } from "../../lib/bills/queries";
import { revalidateBillDocument } from "../../lib/bills/revalidate";

// Authoritative server-side handling for Bills & Expenses Phase 1: secure
// upload + original preservation + lifecycle transitions. Everything that
// persists goes through here - feature-gated, capability-checked (in the
// RPCs), re-validated from the raw bytes. The service-role client is used
// only to put the object in the private bucket and to clean it up on a
// duplicate/race; the canonical row is written by the SECURITY DEFINER
// create_bill_document() RPC as the session user (so has_space_capability
// runs against the real caller).

const ORIGINAL_BUCKET = "bill-documents";

export type UploadBillResult =
  | { ok: true; id: string }
  | { ok: false; error: string; existingId?: string; code?: string };

export async function uploadBillDocument(
  formData: FormData,
): Promise<UploadBillResult> {
  const workspaceId = await getActiveWorkspaceId();
  try {
    assertBillsEnabled(workspaceId);
  } catch (err) {
    if (err instanceof FeatureDisabledError) {
      return { ok: false, error: "Bills & Expenses isn't available here.", code: "feature_disabled" };
    }
    throw err;
  }
  if (!workspaceId) {
    return { ok: false, error: "No active workspace.", code: "no_workspace" };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file was provided.", code: "no_file" };
  }

  // Enforce the size cap before we buffer the whole thing where the
  // browser told us the size; still re-checked against the real byte
  // length below.
  if (file.size > billsMaxUploadBytes()) {
    trackBillEvent("bill_upload_rejected", { reason: "too_large" });
    return { ok: false, error: rejectionMessage("too_large"), code: "too_large" };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    logBillError("upload", err);
    return { ok: false, error: "That file couldn't be read.", code: "unreadable" };
  }

  const validation = await validateUpload({
    bytes,
    declaredName: file.name,
    maxBytes: billsMaxUploadBytes(),
    maxPages: billsMaxPageCount(),
  });
  if (!validation.ok) {
    trackBillEvent("bill_upload_rejected", { reason: validation.reason });
    return { ok: false, error: rejectionMessage(validation.reason), code: validation.reason };
  }

  const mimeType: SupportedMime = validation.mimeType;
  const checksum = await sha256Hex(bytes);
  const storageKey = generateStorageKey(workspaceId, checksum, mimeType);

  const session = await supabaseSession();
  const admin = supabaseServer();

  // Fast-path duplicate check so we don't even upload a redundant object.
  const { data: dup } = await session
    .from("bill_documents")
    .select("id")
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (dup?.id) {
    trackBillEvent("bill_upload_rejected", { reason: "duplicate_document" });
    return {
      ok: false,
      error: "You've already uploaded this exact document.",
      code: "duplicate_document",
      existingId: dup.id,
    };
  }

  // Put the immutable original. upsert:false - a byte-identical object at
  // this key means a concurrent request already wrote it; tolerate that
  // and let the RPC's uniqueness check be the arbiter (mirrors the
  // reports PDF route).
  let uploadedByUs = true;
  const { error: putError } = await admin.storage
    .from(ORIGINAL_BUCKET)
    .upload(storageKey, bytes, { contentType: mimeType, upsert: false });
  if (putError) {
    if (putError.message.toLowerCase().includes("already exists")) {
      uploadedByUs = false;
    } else {
      logBillError("storage_put", putError);
      return { ok: false, error: "Couldn't store that document. Try again.", code: "storage" };
    }
  }

  const { data: rpcData, error: rpcError } = await session.rpc("create_bill_document", {
    payload: {
      workspace_id: workspaceId,
      intake_channel: "manual_upload",
      original_filename: file.name.slice(0, 300) || "document",
      sanitized_filename: validation.sanitizedFilename,
      storage_key: storageKey,
      mime_type: mimeType,
      byte_size: validation.byteSize,
      page_count: validation.pageCount,
      checksum_sha256: checksum,
    },
  });

  if (rpcError) {
    logBillError("record", rpcError);
    if (uploadedByUs) {
      await admin.storage.from(ORIGINAL_BUCKET).remove([storageKey]);
    }
    return { ok: false, error: "Couldn't record that document. Try again.", code: "record" };
  }

  const result = rpcData as
    | { ok: true; id: string }
    | { ok: false; error: string; existing_id: string };

  if (!result.ok) {
    // A race lost to a concurrent identical upload - keep the winner's
    // object, drop ours only if we were the ones who wrote it.
    if (uploadedByUs) {
      await admin.storage.from(ORIGINAL_BUCKET).remove([storageKey]);
    }
    trackBillEvent("bill_upload_rejected", { reason: "duplicate_document" });
    return {
      ok: false,
      error: "You've already uploaded this exact document.",
      code: "duplicate_document",
      existingId: result.existing_id,
    };
  }

  trackBillEvent("bill_uploaded", { mime: mimeType });

  // When extraction is enabled for this workspace, hand the document to
  // the Phase 2 worker by moving it into the queue. Otherwise it stays
  // at 'stored' until the Phase 7 review workflow picks it up. A failure
  // here is non-fatal - the document is safely stored and can be
  // re-queued.
  if (isBillsExtractionEnabled(workspaceId)) {
    const { error: queueError } = await session.rpc("transition_bill_document", {
      p_id: result.id,
      p_to_state: "queued",
      p_reason: null,
      p_evidence: {},
    });
    if (queueError) logBillError("transition", queueError);
  }

  revalidatePath("/bills");
  return { ok: true, id: result.id };
}

export type TransitionBillResult =
  | { ok: true; status: string; changed: boolean }
  | { ok: false; error: string };

/** Thin wrapper over transition_bill_document for the Phase 1 manual
 *  controls (archive, retry a failed document). Full review-workflow
 *  transitions arrive with the Phase 6/7 review workspace. */
export async function transitionBillDocument(
  id: string,
  toState: string,
  reason?: string,
): Promise<TransitionBillResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }

  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("transition_bill_document", {
      p_id: id,
      p_to_state: toState,
      p_reason: reason ?? null,
      p_evidence: {},
    });
    if (error) {
      logBillError("transition", error);
      return { ok: false, error: "That change couldn't be applied." };
    }
    const res = data as
      | { ok: true; changed: boolean; status: string }
      | { ok: false; error: string; from?: string; to?: string };
    if (!res.ok) {
      return { ok: false, error: "That isn't a valid change for this document." };
    }
    trackBillEvent("bill_status_changed", { to: toState });
    revalidatePath("/bills");
    revalidatePath(`/bills/${id}`);
    return { ok: true, status: res.status, changed: res.changed };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Archive a document (retention-aware: this never hard-deletes; a
 *  deletion_restricted document still archives). Audited by the RPC. */
export async function archiveBillDocument(id: string): Promise<TransitionBillResult> {
  const result = await transitionBillDocument(id, "archived");
  if (result.ok) trackBillEvent("bill_archived", {});
  return result;
}

export type RetryExtractionResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

/** Re-queue a failed or stuck document for extraction. bill.review-gated
 *  (enforced by the RPC). */
export async function retryBillExtraction(id: string): Promise<RetryExtractionResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("retry_bill_extraction", {
      p_bill_document_id: id,
    });
    if (error) {
      logBillError("transition", error);
      return { ok: false, error: "That couldn't be retried." };
    }
    const res = data as { ok: boolean; status?: string; error?: string };
    if (!res.ok) {
      return { ok: false, error: "This document can't be retried from its current state." };
    }
    trackBillEvent("bill_processing_retried", {});
    revalidatePath("/bills");
    revalidatePath(`/bills/${id}`);
    return { ok: true, status: res.status ?? "queued" };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

export type ResolveDuplicateResult =
  | { ok: true; resolution: string }
  | { ok: false; error: string };

/** Resolve one duplicate candidate (kept_both | merged | dismissed).
 *  bill.review-gated by the RPC. */
export async function resolveBillDuplicate(
  candidateId: string,
  resolution: "kept_both" | "merged" | "dismissed",
  documentId: string,
): Promise<ResolveDuplicateResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("resolve_bill_duplicate_candidate", {
      p_id: candidateId,
      p_resolution: resolution,
    });
    if (error) {
      logBillError("transition", error);
      return { ok: false, error: "That couldn't be applied." };
    }
    const res = data as { ok: boolean; resolution?: string };
    if (!res.ok) return { ok: false, error: "That isn't a valid resolution." };
    trackBillEvent("bill_status_changed", { to: `dup_${resolution}` });
    revalidatePath(`/bills/${documentId}`);
    return { ok: true, resolution: res.resolution ?? resolution };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

// --- Phase 5: supplier resolution ---------------------------------

export type LinkSupplierResult = { ok: true } | { ok: false; error: string };

export async function linkBillSupplier(
  documentId: string,
  supplierId: string | null,
): Promise<LinkSupplierResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("link_bill_supplier", {
      p_bill_document_id: documentId,
      p_supplier_id: supplierId,
    });
    if (error) {
      logBillError("transition", error);
      return { ok: false, error: "That couldn't be applied." };
    }
    if (!(data as { ok: boolean }).ok) {
      return { ok: false, error: "That supplier isn't valid here." };
    }
    trackBillEvent("bill_supplier_selected", {});
    revalidatePath(`/bills/${documentId}`);
    return { ok: true };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

export type SupplierSearchResult =
  | { ok: true; rows: SupplierSearchRow[] }
  | { ok: false; error: string };

export async function searchSuppliersAction(query: string): Promise<SupplierSearchResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId) || !workspaceId) {
    return { ok: false, error: "Not available." };
  }
  const trimmed = query.trim();
  if (trimmed.length < 2) return { ok: true, rows: [] };
  try {
    const rows = await searchSuppliers(workspaceId, trimmed);
    return { ok: true, rows };
  } catch (err) {
    logBillError("record", err);
    return { ok: false, error: "Search failed." };
  }
}

export type CreateSupplierResult =
  | { ok: true; supplierId: string }
  | { ok: false; error: string; existingId?: string };

export async function createSupplierForBill(
  documentId: string,
  input: {
    displayName: string;
    taxId?: string;
    email?: string;
    phone?: string;
    address?: string;
  },
): Promise<CreateSupplierResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId) || !workspaceId) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    return { ok: false, error: "A supplier name is required." };
  }
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("create_supplier", {
      payload: {
        workspace_id: workspaceId,
        display_name: displayName,
        name_key: normalizeSupplierName(displayName) ?? displayName.toLowerCase(),
        tax_id: input.taxId?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        source: "document_extracted",
      },
    });
    if (error) {
      logBillError("record", error);
      if (/bill\.manage/i.test(error.message)) {
        return { ok: false, error: "You don't have permission to create suppliers." };
      }
      return { ok: false, error: "Couldn't create that supplier." };
    }
    const res = data as
      | { ok: true; id: string }
      | { ok: false; error: string; existing_id: string };
    if (!res.ok) {
      if (res.error === "tax_id_exists") {
        return {
          ok: false,
          error: "A supplier with that tax ID already exists.",
          existingId: res.existing_id,
        };
      }
      return { ok: false, error: "Couldn't create that supplier." };
    }

    const link = await linkBillSupplier(documentId, res.id);
    if (!link.ok) return { ok: false, error: link.error };
    trackBillEvent("bill_supplier_selected", { created: true });
    return { ok: true, supplierId: res.id };
  } catch (err) {
    logBillError("record", err);
    return { ok: false, error: "Something went wrong." };
  }
}

// --- Phase 6: approval, matching & posting -----------------------

const APPROVE_ERRORS: Record<string, string> = {
  blocking_findings: "There's a blocking issue in the Checks section. Resolve it first.",
  unresolved_duplicate:
    "There's an unresolved likely-duplicate. Resolve it in Possible duplicates first.",
  self_approval_forbidden: "You can't approve a document you uploaded. Ask another approver.",
  not_reviewable: "This document isn't in a state that can be approved.",
  missing_currency_or_total: "The currency or total is missing. Add it before approving.",
};

export type ApproveBillResult = { ok: true; billId: string } | { ok: false; error: string };

export async function approveBillAction(
  documentId: string,
  input: { category?: string; notes?: string } = {},
): Promise<ApproveBillResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("approve_bill", {
      payload: {
        bill_document_id: documentId,
        category: input.category?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    if (error) {
      logBillError("transition", error);
      if (/bill\.approve/i.test(error.message)) {
        return { ok: false, error: "You don't have permission to approve documents." };
      }
      return { ok: false, error: "Approval failed." };
    }
    const res = data as { ok: boolean; bill_id?: string; error?: string };
    if (!res.ok) {
      return { ok: false, error: APPROVE_ERRORS[res.error ?? ""] ?? "Approval was refused." };
    }
    trackBillEvent("bill_approved", {});
    revalidatePath("/bills");
    revalidatePath(`/bills/${documentId}`);
    return { ok: true, billId: res.bill_id! };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

export type PostBillResult =
  | { ok: true; status: string; links: number }
  | { ok: false; error: string };

export async function postBillAction(
  documentId: string,
  transactionIds: string[],
  paidState?: "unpaid" | "partial" | "paid",
): Promise<PostBillResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  const ids = [...new Set(transactionIds)].sort();
  // Deterministic key so a double-click / retry posts exactly once.
  const idempotencyKey = await sha256Hex(
    new TextEncoder().encode(`${documentId}|${ids.join(",")}|${paidState ?? ""}`),
  );
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("post_bill", {
      payload: {
        bill_document_id: documentId,
        idempotency_key: idempotencyKey,
        transaction_ids: ids,
        paid_state: paidState ?? null,
      },
    });
    if (error) {
      logBillError("transition", error);
      if (/bill\.post/i.test(error.message)) {
        return { ok: false, error: "You don't have permission to post documents." };
      }
      if (/transaction_already_linked/i.test(error.message)) {
        return { ok: false, error: "One of those transactions is already linked to another bill." };
      }
      return { ok: false, error: "Posting failed." };
    }
    const res = data as { ok: boolean; status?: string; links?: number; error?: string };
    if (!res.ok) {
      if (res.error === "not_approved") return { ok: false, error: "Approve the document first." };
      if (res.error === "already_posted") return { ok: false, error: "This document was already posted." };
      return { ok: false, error: "Posting was refused." };
    }
    trackBillEvent("bill_posting_completed", { status: res.status ?? "" });
    revalidatePath("/bills");
    revalidatePath(`/bills/${documentId}`);
    return { ok: true, status: res.status ?? "posted", links: res.links ?? 0 };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function unlinkBillTransactionAction(
  linkId: string,
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("unlink_bill_transaction", { p_link_id: linkId });
    if (error) {
      logBillError("transition", error);
      return { ok: false, error: "That couldn't be unlinked." };
    }
    if (!(data as { ok: boolean }).ok) return { ok: false, error: "That couldn't be unlinked." };
    trackBillEvent("bill_match_rejected", {});
    revalidatePath(`/bills/${documentId}`);
    return { ok: true };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

// --- Phase 7: review workspace --------------------------------

export type CorrectFieldResult =
  | { ok: true; cleared: boolean }
  | { ok: false; error: string };

/** A bill.review holder overrides one extracted field. Raw + model
 *  values are preserved; the correction bumps the document's
 *  review_revision. Validation is re-run immediately so approval never
 *  acts on a stale check. */
export async function correctBillField(
  documentId: string,
  fieldKey: string,
  value: string,
): Promise<CorrectFieldResult> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId) || !workspaceId) {
    return { ok: false, error: "Bills & Expenses isn't available here." };
  }
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("correct_bill_field", {
      p_bill_document_id: documentId,
      p_field_key: fieldKey,
      p_value: value,
    });
    if (error) {
      logBillError("transition", error);
      if (/bill\.review/i.test(error.message)) {
        return { ok: false, error: "You don't have permission to edit fields." };
      }
      return { ok: false, error: "That change couldn't be saved." };
    }
    const res = data as { ok: boolean; cleared?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: "That change couldn't be saved." };

    // Re-run the deterministic checks against the corrected value.
    try {
      await revalidateBillDocument(supabaseServer(), documentId, workspaceId);
    } catch (err) {
      logBillError("record", err);
    }

    trackBillEvent("bill_field_corrected", {});
    revalidatePath(`/bills/${documentId}`);
    return { ok: true, cleared: !!res.cleared };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function revalidateBillDocumentAction(
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId) || !workspaceId) {
    return { ok: false, error: "Not available." };
  }
  // Authorisation: only a reviewer may trigger a re-check.
  const session = await supabaseSession();
  const { data: cap } = await session.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "bill.review",
  });
  if (cap !== true) return { ok: false, error: "You don't have permission." };
  try {
    await revalidateBillDocument(supabaseServer(), documentId, workspaceId);
    revalidatePath(`/bills/${documentId}`);
    return { ok: true };
  } catch (err) {
    logBillError("record", err);
    return { ok: false, error: "Re-check failed." };
  }
}

export async function addBillCommentAction(
  documentId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) return { ok: false, error: "Not available." };
  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: "Write something first." };
  try {
    const session = await supabaseSession();
    const { data, error } = await session.rpc("add_bill_comment", {
      p_bill_document_id: documentId,
      p_body: trimmed.slice(0, 4000),
    });
    if (error) {
      logBillError("transition", error);
      if (/bill\.review/i.test(error.message)) {
        return { ok: false, error: "You don't have permission to comment." };
      }
      return { ok: false, error: "Couldn't add that note." };
    }
    if (!(data as { ok: boolean }).ok) return { ok: false, error: "Couldn't add that note." };
    trackBillEvent("bill_review_opened", {});
    revalidatePath(`/bills/${documentId}`);
    return { ok: true };
  } catch (err) {
    logBillError("transition", err);
    return { ok: false, error: "Something went wrong." };
  }
}
