"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { isImportStudioEnabled } from "../../../lib/integrations/gate";
import { parseCsv } from "../../../lib/csv";
import { parseXlsx } from "../../../lib/xlsx-read";
import { profileTabularData } from "../../../lib/integrations/profile";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_RECORDS = 5000; // staging rows persisted per batch in this phase
const IMPORT_BUCKET = "integration-imports";

export type UploadImportResult =
  | { ok: true; batchId: string }
  | { ok: false; error: string };

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
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isImportStudioEnabled(workspaceId)) {
    return { ok: false, error: "Importing isn’t available for this Space." };
  }

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: allowed, error: capError } = await supabase.rpc(
    "has_space_capability",
    { p_workspace_id: workspaceId, p_capability: "integration.import" },
  );
  if (capError || allowed !== true) {
    return {
      ok: false,
      error: "You don’t have permission to import data into this Space.",
    };
  }

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
      created_by: user.id,
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
