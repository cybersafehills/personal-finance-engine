"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { logSpacesError } from "../../../../lib/spaces/monitoring";
import type { NormalizedStatementRow } from "../../../../lib/statement-import";
import { trackSpacesEvent } from "../../../../lib/spaces/analytics";
import {
  inboundAddressFor,
  isEmailStatementIngestEnabled,
} from "../../../../lib/email-ingest";

export type ImportStatementResult =
  | {
    ok: true;
    created: number;
    flaggedPossibleDuplicate: number;
    skipped: number;
  }
  | { ok: false; error: string };

const MAX_ROWS = 5000;
const DIRECTIONS = new Set(["in", "out", "neutral"]);

/**
 * Hands one CSV statement's already-normalized rows to
 * import_statement_transactions (migration 20260925000000). The RPC owns
 * every real rule (source ownership, fingerprint matching, per-line
 * de-dupe, the possible_duplicate flag); this action only shape-checks
 * the payload and caps its size.
 */
export async function importStatement(
  financialSourceId: string,
  rows: NormalizedStatementRow[],
): Promise<ImportStatementResult> {
  if (!financialSourceId) {
    return { ok: false, error: "Choose which account this statement is for." };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "No importable rows were found in that file." };
  }
  if (rows.length > MAX_ROWS) {
    return {
      ok: false,
      error:
        `That file has ${rows.length} rows; import at most ${MAX_ROWS} at a time.`,
    };
  }

  const clean = rows
    .filter(
      (r) =>
        r &&
        typeof r.occurred_at === "string" &&
        Number.isFinite(r.amount_minor) &&
        r.amount_minor >= 0 &&
        DIRECTIONS.has(r.direction),
    )
    .map((r) => ({
      occurred_at: r.occurred_at,
      amount_minor: Math.round(r.amount_minor),
      direction: r.direction,
      counterparty: r.counterparty ?? null,
      external_ref: r.external_ref ?? null,
    }));

  if (clean.length === 0) {
    return { ok: false, error: "None of the rows could be read for import." };
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("import_statement_transactions", {
    p_financial_source_id: financialSourceId,
    p_rows: clean,
  });

  if (error) {
    logSpacesError("statement_import", error);
    return {
      ok: false,
      error: error.message.includes("own")
        ? "You can only import statements for your own accounts."
        : "Could not import that statement.",
    };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const created = Number(result.created ?? 0);
  const flaggedPossibleDuplicate = Number(result.flagged_possible_duplicate ?? 0);
  const skipped = Number(result.skipped ?? 0);
  trackSpacesEvent("statement_imported", {
    created,
    flagged: flaggedPossibleDuplicate,
    skipped,
  });

  revalidatePath("/transactions");
  revalidatePath("/transactions/review");
  revalidatePath("/");

  return { ok: true, created, flaggedPossibleDuplicate, skipped };
}

// ---------------------------------------------------------------------------
// Email statement ingestion (ADR 0018 Slice B). A source can be given a
// private inbound address; mail sent there is parsed and imported by the
// `inbound-email` Edge Function. These actions only drive the per-source
// token lifecycle RPCs (migration 20261204000000) - all owner-gated
// server-side, never trusted from the client.
// ---------------------------------------------------------------------------

export type IngestEmailResult =
  | { ok: true; address: string | null }
  | { ok: false; error: string };

const EMAIL_OFF: IngestEmailResult = {
  ok: false,
  error: "Email statement import isn't available yet.",
};

async function runIngestEmailRpc(
  rpc: "set_source_ingest_email" | "rotate_source_ingest_email",
  financialSourceId: string,
): Promise<IngestEmailResult> {
  if (!isEmailStatementIngestEnabled()) return EMAIL_OFF;
  if (!financialSourceId) {
    return { ok: false, error: "Choose which account this is for." };
  }
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc(rpc, {
    p_source_id: financialSourceId,
  });
  if (error) {
    logSpacesError("statement_import", error);
    return {
      ok: false,
      error: error.message.includes("own")
        ? "You can only manage your own accounts."
        : "Could not update the inbound address.",
    };
  }
  revalidatePath("/settings/sources/import");
  return { ok: true, address: data ? inboundAddressFor(String(data)) : null };
}

/** Mint the source's inbound address (idempotent - returns the existing one). */
export async function enableIngestEmail(
  financialSourceId: string,
): Promise<IngestEmailResult> {
  const res = await runIngestEmailRpc("set_source_ingest_email", financialSourceId);
  if (res.ok) trackSpacesEvent("statement_email_enabled");
  return res;
}

/** Rotate to a fresh address, invalidating the previous one. */
export async function rotateIngestEmail(
  financialSourceId: string,
): Promise<IngestEmailResult> {
  const res = await runIngestEmailRpc(
    "rotate_source_ingest_email",
    financialSourceId,
  );
  if (res.ok) trackSpacesEvent("statement_email_rotated");
  return res;
}

/** Disable inbound mail for this source (clears the token). */
export async function disableIngestEmail(
  financialSourceId: string,
): Promise<IngestEmailResult> {
  if (!isEmailStatementIngestEnabled()) return EMAIL_OFF;
  if (!financialSourceId) {
    return { ok: false, error: "Choose which account this is for." };
  }
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("clear_source_ingest_email", {
    p_source_id: financialSourceId,
  });
  if (error) {
    logSpacesError("statement_import", error);
    return {
      ok: false,
      error: error.message.includes("own")
        ? "You can only manage your own accounts."
        : "Could not disable the inbound address.",
    };
  }
  trackSpacesEvent("statement_email_disabled");
  revalidatePath("/settings/sources/import");
  return { ok: true, address: null };
}
