import "server-only";
import { supabaseSession } from "../supabase-session-server";

// Owner-facing reads. Session client => RLS scopes every row to workspaces the
// signed-in user belongs to; nothing here uses the service role.

export type OwnerRequest = {
  id: string;
  workspace_id: string;
  amount_minor: number | string;
  currency: string;
  destination_type: "momo_phone" | "merchant_code";
  destination_value: string;
  recipient_display: string;
  reference: string | null;
  expires_at: string;
  status: string; // effective (derived 'expired' included)
  matched_transaction_id: string | null;
  created_at: string;
  paid_marked_at: string | null;
  cancelled_at: string | null;
};

const COLUMNS =
  "id, workspace_id, amount_minor, currency, destination_type, destination_value, recipient_display, reference, expires_at, status, matched_transaction_id, created_at, paid_marked_at, cancelled_at";

export async function listPaymentRequests(
  workspaceId: string,
): Promise<OwnerRequest[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_requests_v")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("listPaymentRequests failed:", error.message);
    return [];
  }
  return (data ?? []) as OwnerRequest[];
}

export async function getPaymentRequest(
  workspaceId: string,
  id: string,
): Promise<OwnerRequest | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_requests_v")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getPaymentRequest failed:", error.message);
    return null;
  }
  return (data as OwnerRequest | null) ?? null;
}

export type RequestEvent = {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

export async function getRequestEvents(id: string): Promise<RequestEvent[]> {
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("payment_request_events")
    .select("id, event_type, created_at, metadata")
    .eq("payment_request_id", id)
    .order("created_at", { ascending: true });
  return (data ?? []) as RequestEvent[];
}

export type MatchCandidate = {
  id: string;
  occurred_at: string;
  counterparty_name: string | null;
};

/**
 * Settled INCOMING transactions of exactly this amount that no other request
 * has claimed - the only ones link_payment_request_transaction will accept.
 * (Transactions are RWF-only today, so other currencies get none.)
 */
export async function getMatchCandidates(
  r: OwnerRequest,
): Promise<MatchCandidate[]> {
  if (r.currency !== "RWF") return [];
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("transactions")
    .select("id, occurred_at, counterparty_name")
    .eq("workspace_id", r.workspace_id)
    .eq("direction", "in")
    .eq("settlement_state", "settled")
    .eq("currency", r.currency)
    .eq("principal_effect_rwf", Number(r.amount_minor))
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as MatchCandidate[];
  if (rows.length === 0) return [];
  const { data: taken } = await supabase
    .from("payment_requests")
    .select("matched_transaction_id")
    .in("matched_transaction_id", rows.map((x) => x.id));
  const claimed = new Set((taken ?? []).map((t) => t.matched_transaction_id));
  return rows.filter((x) => !claimed.has(x.id));
}
