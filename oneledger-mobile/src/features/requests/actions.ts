import { selectedWorkspaceId } from "@/features/spaces/selected-space";
import { bearerPost, failureForOutcome } from "@/api/bearer";
import { supabase } from "@/api/supabase";

import { friendlyRequestError } from "./input";
import { parseCandidate, parseCreateResponse, parseRequestRow, type CreateResult } from "./parse";
import type { MatchCandidate, PaymentRequest } from "./types";

// Reads run as the signed-in user under RLS (payment_requests_v); changes call
// the database functions, which check membership/ownership and audit each one.
// Creating goes through the web API because only the server may generate the
// secret link token (it is shown once and never stored).

const COLUMNS =
  "id, workspace_id, amount_minor, currency, destination_type, destination_value, recipient_display, reference, expires_at, status, matched_transaction_id, created_at";

export async function createRequest(body: Record<string, unknown>): Promise<CreateResult> {
  const result = await bearerPost("/api/mobile/payment-requests", body);
  if (result.kind !== "response") {
    return { ok: false, message: failureForOutcome(result, "Payment requests").message };
  }
  return parseCreateResponse(result.status, result.body);
}

export async function listRequests(): Promise<{ ok: true; requests: PaymentRequest[] } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: "The app isn't connected yet." };
  const { data, error } = await supabase
    .from("payment_requests_v")
    .select(COLUMNS).eq("workspace_id", selectedWorkspaceId())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, message: "Couldn't load your requests. Check your connection and try again." };
  return { ok: true, requests: (data ?? []).map(parseRequestRow).filter((r): r is PaymentRequest => r !== null) };
}

export async function getRequest(id: string): Promise<{ ok: true; request: PaymentRequest; candidates: MatchCandidate[] } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: "The app isn't connected yet." };
  const { data, error } = await supabase.from("payment_requests_v").select(COLUMNS).eq("workspace_id", selectedWorkspaceId()).eq("id", id).maybeSingle();
  if (error) return { ok: false, message: "Couldn't load this request. Check your connection and try again." };
  const request = parseRequestRow(data);
  if (!request) return { ok: false, message: "That request couldn't be found." };

  // Settled incoming payments of exactly this amount that no other request has
  // claimed: the only ones the database will accept as a match (RWF only).
  let candidates: MatchCandidate[] = [];
  if ((request.status === "open" || request.status === "expired") && request.currency === "RWF") {
    const { data: txs } = await supabase
      .from("transactions")
      .select("id, occurred_at, counterparty_name")
      .eq("workspace_id", request.workspaceId)
      .eq("direction", "in")
      .eq("settlement_state", "settled")
      .eq("currency", "RWF")
      .eq("principal_effect_rwf", Number(request.amountMinor))
      .neq("dedupe_state", "merged")
      .order("occurred_at", { ascending: false })
      .limit(20);
    const rows = (txs ?? []).map(parseCandidate).filter((c): c is MatchCandidate => c !== null);
    if (rows.length > 0) {
      const { data: taken } = await supabase.from("payment_requests").select("matched_transaction_id").in("matched_transaction_id", rows.map((r) => r.id));
      const claimed = new Set((taken ?? []).map((t) => t.matched_transaction_id as string));
      candidates = rows.filter((r) => !claimed.has(r.id));
    }
  }
  return { ok: true, request, candidates };
}

export type ChangeResult = { ok: true } | { ok: false; message: string };

async function rpc(fn: string, args: Record<string, unknown>): Promise<ChangeResult> {
  if (!supabase) return { ok: false, message: "The app isn't connected yet." };
  const { error } = await supabase.rpc(fn, args);
  return error ? { ok: false, message: friendlyRequestError(error.message) } : { ok: true };
}

export const cancelRequest = (id: string) => rpc("cancel_payment_request", { p_id: id });
/** Your own statement that you were paid some other way. Not verification. */
export const markRequestPaid = (id: string, note: string) =>
  rpc("mark_payment_request_paid_by_owner", { p_id: id, p_note: note.trim().slice(0, 200) || null });
export const linkRequestPayment = (id: string, transactionId: string) =>
  rpc("link_payment_request_transaction", { p_id: id, p_transaction_id: transactionId });
