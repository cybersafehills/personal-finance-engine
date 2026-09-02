"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { isImportStudioEnabled } from "../../../lib/integrations/gate";
import { parseCsv } from "../../../lib/csv";
import { parseXlsx } from "../../../lib/xlsx-read";
import { profileTabularData } from "../../../lib/integrations/profile";
import {
  headerSignature,
  type ImportColumnMapping,
  normalizeImportRow,
} from "../../../lib/integrations/mapping";
import {
  defaultValidationContext,
  tallyValidation,
  validateNormalizedRow,
  type RowValidation,
} from "../../../lib/integrations/validation";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_RECORDS = 5000; // staging rows persisted per batch in this phase
const IMPORT_BUCKET = "integration-imports";
const RECORD_CHUNK = 500;

export type UploadImportResult =
  | { ok: true; batchId: string }
  | { ok: false; error: string };

type IntegrationCapability =
  | "integration.import"
  | "integration.import_approve"
  | "integration.configure";

type AccessOk = { ok: true; workspaceId: string; userId: string };
type AccessErr = { ok: false; error: string };

/** Gate + auth + capability preamble shared by every import action. */
async function requireImportAccess(
  capability: IntegrationCapability,
): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isImportStudioEnabled(workspaceId)) {
    return { ok: false, error: "Importing isn’t available for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: capability,
  });
  if (error || allowed !== true) {
    return {
      ok: false,
      error: "You don’t have permission to do that in this Space.",
    };
  }
  return { ok: true, workspaceId, userId: user.id };
}

/** Keep only safe filename characters; never trust the client's string. */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/^.*[\\/]/, "") // strip any path
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
  return cleaned.replace(/^[._]+/, "") || "import";
}

function fileKind(name: string): "csv" | "xlsx" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

export async function uploadImportFile(
  formData: FormData,
): Promise<UploadImportResult> {
  const access = await requireImportAccess("integration.import");
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to import." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That file is larger than the 10 MB limit." };
  }

  const kind = fileKind(file.name);
  if (!kind) {
    return {
      ok: false,
      error: "Only .csv and .xlsx files are supported right now.",
    };
  }

  // --- parse + profile entirely in memory; write nothing until it's valid.
  const bytes = new Uint8Array(await file.arrayBuffer());
  let headers: string[];
  let rows: string[][];
  try {
    if (kind === "csv") {
      const parsed = parseCsv(new TextDecoder().decode(bytes));
      headers = parsed.headers;
      rows = parsed.rows;
    } else {
      const parsed = await parseXlsx(bytes);
      const sheet =
        parsed.sheets.find((s) => s.headers.length > 0 && s.rows.length > 0) ??
          parsed.sheets[0];
      if (!sheet) {
        return { ok: false, error: "That workbook has no readable sheets." };
      }
      headers = sheet.headers;
      rows = sheet.rows;
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? error.message
        : "That file could not be read.",
    };
  }

  if (headers.length === 0 || rows.length === 0) {
    return {
      ok: false,
      error: "That file has no data rows under a header row.",
    };
  }

  const profile = profileTabularData(headers, rows);
  const truncated = rows.length > MAX_RECORDS;
  const stagedRows = truncated ? rows.slice(0, MAX_RECORDS) : rows;

  // --- persist. service-role after the capability check above (same model
  // as the report-artifacts bucket): the check IS the boundary here.
  const admin = supabaseServer();
  const safeName = sanitizeFilename(file.name);

  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      source_kind: kind,
      original_filename: file.name.slice(0, 255),
      status: "uploaded",
    })
    .select("id")
    .single();
  if (batchError || !batch) {
    console.error("uploadImportFile: batch insert failed", batchError?.message);
    return { ok: false, error: "Could not start the import. Please try again." };
  }

  const storagePath = `${workspaceId}/${batch.id}/${safeName}`;
  const { error: uploadError } = await admin.storage
    .from(IMPORT_BUCKET)
    .upload(storagePath, bytes, {
      contentType: kind === "csv"
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (uploadError) {
    console.error("uploadImportFile: storage upload failed", uploadError.message);
    await admin
      .from("import_batches")
      .update({ status: "failed", error: { stage: "upload" } })
      .eq("id", batch.id);
    return { ok: false, error: "Could not store the file. Please try again." };
  }

  const records = stagedRows.map((cells, index) => ({
    import_batch_id: batch.id,
    workspace_id: workspaceId,
    row_index: index,
    raw_cells: { cells },
    status: "needs_mapping" as const,
  }));
  const { error: recordsError } = await admin
    .from("import_records")
    .insert(records);
  if (recordsError) {
    console.error("uploadImportFile: records insert failed", recordsError.message);
    await admin
      .from("import_batches")
      .update({ status: "failed", error: { stage: "records" } })
      .eq("id", batch.id);
    return { ok: false, error: "Could not stage the file rows. Please try again." };
  }

  await admin
    .from("import_batches")
    .update({
      status: "profiled",
      storage_path: storagePath,
      detected: { ...profile, truncated, stagedRowCount: stagedRows.length },
      mapping: { suggested: profile.columnGuess },
      row_counts: {
        total: rows.length,
        ready: profile.readyRows,
        invalid: profile.invalidRows,
        needs_review: 0,
        possible_duplicate: 0,
        imported: 0,
        failed: 0,
        skipped: profile.blankRows + profile.repeatedHeaderRows,
      },
    })
    .eq("id", batch.id);

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "import.uploaded",
    severity: "info",
    ref_type: "import_batch",
    ref_id: batch.id,
    summary: `${file.name} uploaded — ${profile.readyRows} of ${rows.length} rows ready to map`,
    context: { sourceKind: kind, rowCount: rows.length, truncated },
  });

  revalidatePath("/integrations/imports");
  revalidatePath("/integrations");
  return { ok: true, batchId: batch.id };
}

export type ApplyMappingResult =
  | {
    ok: true;
    counts: { ready: number; needsReview: number; invalid: number; total: number };
  }
  | { ok: false; error: string };

/**
 * Re-normalize and re-validate every staged row of a batch against
 * `mapping`, persisting per-row status + issues and the batch-level
 * counts. This is the authoritative pass - the client's live preview is
 * advisory only.
 */
export async function applyImportMapping(
  batchId: string,
  mapping: ImportColumnMapping,
): Promise<ApplyMappingResult> {
  const access = await requireImportAccess("integration.import");
  if (!access.ok) return access;
  const { workspaceId } = access;

  const admin = supabaseServer();
  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (batchError || !batch) {
    return { ok: false, error: "That import could not be found." };
  }
  if (["imported", "committing", "rolled_back"].includes(batch.status)) {
    return { ok: false, error: "This import can no longer be re-mapped." };
  }

  const { data: records, error: recordsError } = await admin
    .from("import_records")
    .select("id, row_index, raw_cells")
    .eq("import_batch_id", batchId)
    .order("row_index", { ascending: true });
  if (recordsError || !records) {
    return { ok: false, error: "Could not load the staged rows." };
  }

  const ctx = defaultValidationContext();
  const statuses: RowValidation["status"][] = [];
  const updates = records.map((record) => {
    const cells =
      ((record.raw_cells as { cells?: string[] })?.cells as string[]) ?? [];
    const normalized = normalizeImportRow(cells, mapping);
    if (!normalized.ok) {
      statuses.push("invalid");
      return {
        id: record.id,
        import_batch_id: batchId,
        workspace_id: workspaceId,
        row_index: record.row_index,
        raw_cells: record.raw_cells,
        normalized: {},
        status: "invalid" as const,
        validation: {
          issues: [
            {
              severity: "blocking",
              code: normalized.reason,
              message: "This row could not be read with the current mapping.",
            },
          ],
        },
      };
    }
    const result = validateNormalizedRow(normalized.row, ctx);
    statuses.push(result.status);
    return {
      id: record.id,
      import_batch_id: batchId,
      workspace_id: workspaceId,
      row_index: record.row_index,
      raw_cells: record.raw_cells,
      normalized: normalized.row,
      status: result.status,
      validation: { issues: result.issues },
    };
  });

  for (let i = 0; i < updates.length; i += RECORD_CHUNK) {
    const { error } = await admin
      .from("import_records")
      .upsert(updates.slice(i, i + RECORD_CHUNK), { onConflict: "id" });
    if (error) {
      console.error("applyImportMapping: upsert failed", error.message);
      return { ok: false, error: "Could not save the mapping results." };
    }
  }

  const counts = tallyValidation(statuses);
  await admin
    .from("import_batches")
    .update({
      status: "validated",
      mapping,
      row_counts: {
        total: updates.length,
        ready: counts.ready,
        needs_review: counts.needsReview,
        invalid: counts.invalid,
        possible_duplicate: 0,
        imported: 0,
        failed: 0,
        skipped: 0,
      },
    })
    .eq("id", batchId);

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "import.mapped",
    severity: counts.invalid > 0 ? "warning" : "info",
    ref_type: "import_batch",
    ref_id: batchId,
    summary:
      `Mapping applied — ${counts.ready} ready, ${counts.needsReview} to review, ${counts.invalid} invalid`,
    context: { counts },
  });

  revalidatePath(`/integrations/imports/${batchId}`);
  return {
    ok: true,
    counts: { ...counts, total: updates.length },
  };
}

export type SaveTemplateResult =
  | { ok: true; templateId: string }
  | { ok: false; error: string };

/** Persist the batch's current mapping as a reusable, versioned template. */
export async function saveImportTemplate(
  batchId: string,
  rawName: string,
): Promise<SaveTemplateResult> {
  const access = await requireImportAccess("integration.configure");
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const name = rawName.trim();
  if (!name) return { ok: false, error: "Give the template a name." };
  if (name.length > 80) {
    return { ok: false, error: "That name is too long." };
  }

  const admin = supabaseServer();
  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .select("detected, mapping")
    .eq("id", batchId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (batchError || !batch) {
    return { ok: false, error: "That import could not be found." };
  }

  const headers =
    ((batch.detected as { headers?: string[] })?.headers as string[]) ?? [];
  const mapping = (batch.mapping ?? {}) as
    & Partial<ImportColumnMapping>
    & { suggested?: unknown };
  if (!mapping.columns) {
    return { ok: false, error: "Map the columns before saving a template." };
  }

  const fields = {
    workspace_id: workspaceId,
    name,
    source_type: "generic",
    header_signature: headerSignature(headers),
    mapping,
    date_format: mapping.dateOrder ?? null,
    direction_convention: mapping.directionMode ?? null,
    currency: mapping.defaultCurrency ?? null,
    created_by: userId,
  };

  const { data: existing } = await admin
    .from("import_templates")
    .select("id, version")
    .eq("workspace_id", workspaceId)
    .eq("name", name)
    .maybeSingle();

  let templateId: string;
  if (existing) {
    const { error } = await admin
      .from("import_templates")
      .update({ ...fields, version: existing.version + 1 })
      .eq("id", existing.id);
    if (error) {
      console.error("saveImportTemplate: update failed", error.message);
      return { ok: false, error: "Could not update the template." };
    }
    templateId = existing.id;
  } else {
    const { data: inserted, error } = await admin
      .from("import_templates")
      .insert(fields)
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("saveImportTemplate: insert failed", error?.message);
      return { ok: false, error: "Could not save the template." };
    }
    templateId = inserted.id;
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "template.saved",
    severity: "info",
    ref_type: "import_template",
    ref_id: templateId,
    summary: `Import template "${name}" ${existing ? "updated" : "saved"}`,
    context: { actorUserId: userId, version: (existing?.version ?? 0) + 1 },
  });

  revalidatePath(`/integrations/imports/${batchId}`);
  return { ok: true, templateId };
}
