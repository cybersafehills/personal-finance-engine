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
