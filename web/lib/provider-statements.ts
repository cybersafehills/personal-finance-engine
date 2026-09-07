import "server-only";
import { randomUUID } from "node:crypto";
import { getActiveWorkspace } from "./queries";
import { supabaseServer } from "./supabase-server";
import { supabaseSession } from "./supabase-session-server";

// Provider-original-document management (master prompt section 16;
// migration 20261218000000). Members upload the verbatim PDF/CSV a bank or
// wallet issued and keep it alongside OneLedger-generated statements. The
// file is never parsed here. The metadata row grants authenticated SELECT
// only; upload + delete run with the service-role client AFTER
// getActiveWorkspace() has confirmed the caller is an active member with a
// writing role, so the row and the stored object never drift.

const BUCKET = "provider-statements";
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const ACCEPTED: Record<string, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export type ProviderStatement = {
  id: string;
  provider: string;
  originalFilename: string;
  periodStart: string | null;
  periodEnd: string | null;
  byteSize: number;
  note: string | null;
  createdAt: string;
  financialSourceId: string | null;
};

export type ProviderUploadResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "document";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getProviderStatements(): Promise<ProviderStatement[]> {
  const workspace = await getActiveWorkspace();
  if (!workspace) return [];

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("provider_statements")
    .select(
      "id, provider, original_filename, period_start, period_end, byte_size, note, created_at, financial_source_id",
    )
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("getProviderStatements failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    provider: r.provider as string,
    originalFilename: r.original_filename as string,
    periodStart: (r.period_start as string) ?? null,
    periodEnd: (r.period_end as string) ?? null,
    byteSize: Number(r.byte_size),
    note: (r.note as string) ?? null,
    createdAt: r.created_at as string,
    financialSourceId: (r.financial_source_id as string) ?? null,
  }));
}

export async function uploadProviderStatement(
  form: FormData,
): Promise<ProviderUploadResult> {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return { ok: false, error: "We couldn't determine your workspace." };
  }
  if (workspace.role === "viewer") {
    return {
      ok: false,
      error: "Viewers can't upload documents in this space.",
    };
  }
  const {
    data: { user },
  } = await (await supabaseSession()).auth.getUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That file is larger than 15 MB." };
  }
  const ext = ACCEPTED[file.type];
  if (!ext) {
    return { ok: false, error: "Upload a PDF, CSV or spreadsheet file." };
  }

  const provider = String(form.get("provider") ?? "").trim();
  if (provider.length < 1 || provider.length > 80) {
    return { ok: false, error: "Enter the provider name (1–80 characters)." };
  }
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  const periodStart = normalizeDate(form.get("periodStart"));
  const periodEnd = normalizeDate(form.get("periodEnd"));
  if (periodStart && periodEnd && periodStart > periodEnd) {
    return { ok: false, error: "The start date is after the end date." };
  }

  let sourceId: string | null = null;
  const rawSource = String(form.get("financialSourceId") ?? "").trim();
  if (rawSource) {
    const admin = supabaseServer();
    const { data: src } = await admin
      .from("financial_sources")
      .select("id")
      .eq("id", rawSource)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!src) {
      return { ok: false, error: "That account isn't in this workspace." };
    }
    sourceId = rawSource;
  }

  const bytes = await file.arrayBuffer();
  const checksum = await sha256Hex(bytes);
  const path = `ws/${workspace.id}/${randomUUID()}.${ext}`;

  const admin = supabaseServer();
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error(
      "uploadProviderStatement storage failed:",
      uploadError.message,
    );
    return { ok: false, error: "The upload failed. Please try again." };
  }

  const { data: inserted, error: insertError } = await admin
    .from("provider_statements")
    .insert({
      workspace_id: workspace.id,
      uploaded_by: user.id,
      financial_source_id: sourceId,
      provider,
      period_start: periodStart,
      period_end: periodEnd,
      original_filename: sanitizeFilename(file.name),
      storage_path: path,
      mime_type: file.type,
      byte_size: file.size,
      file_sha256: checksum,
      note,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    await admin.storage.from(BUCKET).remove([path]);
    console.error(
      "uploadProviderStatement insert failed:",
      insertError?.message,
    );
    return {
      ok: false,
      error: "We couldn't save the document. Please try again.",
    };
  }

  return { ok: true, id: inserted.id as string };
}

export async function deleteProviderStatement(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return { ok: false, error: "We couldn't determine your workspace." };
  }
  if (workspace.role === "viewer") {
    return {
      ok: false,
      error: "Viewers can't remove documents in this space.",
    };
  }

  const admin = supabaseServer();
  const { data: row } = await admin
    .from("provider_statements")
    .select("id, storage_path")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "That document no longer exists." };

  await admin.storage.from(BUCKET).remove([row.storage_path as string]);
  const { error } = await admin
    .from("provider_statements")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspace.id);
  if (error) {
    console.error("deleteProviderStatement failed:", error.message);
    return {
      ok: false,
      error: "We couldn't remove the document. Please try again.",
    };
  }
  return { ok: true };
}

function normalizeDate(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
