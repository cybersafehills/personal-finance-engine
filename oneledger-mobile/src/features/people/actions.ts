import { supabase } from "@/api/supabase";

import { friendlyPeopleError } from "./display";
import type { PersonKind } from "./types";

// Every change runs as the signed-in user under RLS through a database
// function that checks membership, validates, writes an audit event and (for
// merge/split) records an undo handle. Nothing here edits raw transactions.

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; message: string };

async function call<T>(fn: string, args: Record<string, unknown>, pick: (data: unknown) => T): Promise<ActionResult<T>> {
  if (!supabase) return { ok: false, message: "The app isn't connected yet." };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: friendlyPeopleError(error.message) };
  return { ok: true, value: pick(data) };
}

const asId = (d: unknown): string => (typeof d === "string" ? d : "");

/** How many transactions a sort linked to people and merchants (and how many new people that made). */
export type SortOutcome = { linked: number; created: number };

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Sort not-yet-sorted transactions into people and merchants. Safe to repeat. */
export const sortTransactions = (workspaceId: string) =>
  call<SortOutcome>("backfill_counterparties", { p_workspace_id: workspaceId }, (data) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return { linked: count(d.linked), created: count(d.created) };
  });

export const renamePerson = (id: string, name: string, kind: PersonKind) =>
  call("update_counterparty", { p_id: id, p_display_name: name.trim(), p_kind: kind }, () => null);

/** Combine `mergedIds` into `survivorId`. Returns the handle to undo it. */
export const combinePeople = (survivorId: string, mergedIds: string[]) =>
  call("merge_counterparties", { p_survivor: survivorId, p_merged: mergedIds }, asId);

export const undoCombine = (eventId: string) =>
  call("undo_counterparty_merge", { p_event_id: eventId }, () => null);

/** Move the chosen transactions to a new person. Returns the handle to undo it. */
export const separateTransactions = (id: string, transactionIds: string[], name: string) =>
  call(
    "split_counterparty",
    { p_counterparty_id: id, p_identifier_ids: [], p_transaction_ids: transactionIds, p_new_name: name.trim() || null },
    asId,
  );

export const undoSeparate = (eventId: string) =>
  call("undo_counterparty_split", { p_event_id: eventId }, () => null);
