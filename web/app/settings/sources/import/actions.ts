"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import type { NormalizedStatementRow } from "../../../../lib/statement-import";

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
    console.error("importStatement failed:", error.message);
    return {
      ok: false,
      error: error.message.includes("own")
        ? "You can only import statements for your own accounts."
        : "Could not import that statement.",
    };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  revalidatePath("/transactions");
  revalidatePath("/transactions/review");
  revalidatePath("/");

  return {
    ok: true,
    created: Number(result.created ?? 0),
    flaggedPossibleDuplicate: Number(result.flagged_possible_duplicate ?? 0),
    skipped: Number(result.skipped ?? 0),
  };
}
