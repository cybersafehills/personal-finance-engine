"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getActiveWorkspace } from "../../lib/queries";
import {
  friendlyPeopleError,
  isCounterpartiesEnabledFor,
  isPersonKind,
  isUuid,
  type PersonKind,
} from "../../lib/counterparties/directory";
import { loadCounterpartyList } from "../../lib/counterparties/directory-data";

// Owner-side actions for People & merchants. Every action: signed-in user,
// active workspace, the opt-in COUNTERPARTIES flag (+ allowlist) and a
// member-or-above role, all re-checked here. The database is still the
// authority: each RPC re-checks membership under RLS, validates, writes an
// audit event and (merge/split) an undo handle. Nothing here edits a raw
// transaction; original labels never change.

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const OFF = { ok: false, error: "People and merchants aren't available for your account." } as const;
const READ_ONLY = {
  ok: false,
  error: "You can look at people here, but only members can change them.",
} as const;

async function ctx() {
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  const workspace = user ? await getActiveWorkspace() : null;
  const enabled = !!workspace && isCounterpartiesEnabledFor(process.env, workspace.id);
  const canWrite = !!workspace && workspace.role !== "viewer";
  return { supabase, workspace, enabled, canWrite };
}

async function call<T>(
  fn: string,
  args: Record<string, unknown>,
  pick: (data: unknown) => T,
  paths: string[],
): Promise<ActionResult<T>> {
  const { supabase, enabled, canWrite } = await ctx();
  if (!enabled) return OFF;
  if (!canWrite) return READ_ONLY;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: friendlyPeopleError(error.message) };
  for (const p of paths) revalidatePath(p);
  return { ok: true, value: pick(data) };
}

const asId = (d: unknown): string => (typeof d === "string" ? d : "");

/** Sort not-yet-sorted transactions into people and merchants. Safe to repeat. */
export async function sortTransactionsAction(): Promise<ActionResult> {
  const { workspace, enabled } = await ctx();
  if (!enabled || !workspace) return OFF;
  return call("backfill_counterparties", { p_workspace_id: workspace.id }, () => null, ["/people"]);
}

export async function renamePersonAction(
  id: string,
  name: string,
  kind: string,
): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!isUuid(id) || trimmed.length < 1 || trimmed.length > 120 || !isPersonKind(kind)) {
    return { ok: false, error: friendlyPeopleError("invalid_counterparty") };
  }
  return call(
    "update_counterparty",
    { p_id: id, p_display_name: trimmed, p_kind: kind as PersonKind },
    () => null,
    ["/people", `/people/${id}`],
  );
}

/** Combine `mergedIds` into `survivorId`. Returns the handle that undoes it. */
export async function combinePeopleAction(
  survivorId: string,
  mergedIds: string[],
): Promise<ActionResult<string>> {
  const ids = [...new Set(mergedIds)];
  if (
    !isUuid(survivorId) || ids.length < 1 || ids.length > 50 || !ids.every(isUuid) ||
    ids.includes(survivorId)
  ) {
    return { ok: false, error: friendlyPeopleError("invalid_merge") };
  }
  return call(
    "merge_counterparties",
    { p_survivor: survivorId, p_merged: ids },
    asId,
    ["/people", `/people/${survivorId}`],
  );
}

export async function undoCombineAction(eventId: string, personId: string): Promise<ActionResult> {
  if (!isUuid(eventId) || !isUuid(personId)) return { ok: false, error: friendlyPeopleError("not_found") };
  return call(
    "undo_counterparty_merge",
    { p_event_id: eventId },
    () => null,
    ["/people", `/people/${personId}`],
  );
}

/** Move the chosen transactions to a new person. Returns the handle that undoes it. */
export async function separateTransactionsAction(
  id: string,
  transactionIds: string[],
  newName: string,
): Promise<ActionResult<string>> {
  const ids = [...new Set(transactionIds)];
  const name = newName.trim();
  if (!isUuid(id) || ids.length < 1 || ids.length > 500 || !ids.every(isUuid) || name.length > 120) {
    return { ok: false, error: friendlyPeopleError("invalid_split") };
  }
  return call(
    "split_counterparty",
    { p_counterparty_id: id, p_identifier_ids: [], p_transaction_ids: ids, p_new_name: name || null },
    asId,
    ["/people", `/people/${id}`],
  );
}

export async function undoSeparateAction(eventId: string, personId: string): Promise<ActionResult> {
  if (!isUuid(eventId) || !isUuid(personId)) return { ok: false, error: friendlyPeopleError("not_found") };
  return call(
    "undo_counterparty_split",
    { p_event_id: eventId },
    () => null,
    ["/people", `/people/${personId}`],
  );
}

export type PersonOption = { id: string; name: string; kind: PersonKind; txnCount: number };

/** Search for someone to combine with (the person being viewed is filtered out client-side). */
export async function searchPeopleAction(query: string): Promise<ActionResult<PersonOption[]>> {
  const { supabase, workspace, enabled } = await ctx();
  if (!enabled || !workspace) return OFF;
  const q = query.replace(/[%_\\,()*]/g, " ").trim().slice(0, 80);
  if (q === "") return { ok: true, value: [] };
  try {
    const list = await loadCounterpartyList(supabase, workspace.id, {
      q,
      kind: null,
      limit: 10,
      offset: 0,
    });
    return {
      ok: true,
      value: list.counterparties.map((c) => ({
        id: c.id,
        name: c.display_name,
        kind: isPersonKind(c.kind) ? c.kind : "unknown",
        txnCount: c.txn_count,
      })),
    };
  } catch {
    return { ok: false, error: "Couldn't search right now. Try again." };
  }
}
