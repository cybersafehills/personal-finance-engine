import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { paymentSessionFreshnessMinutes } from "./gate";
import { TERMINAL_STATES, type PaymentState } from "./state";

// RLS-scoped reads for Assisted Quick Pay. Every query goes through the
// session client. Writes go through the Phase N SECURITY DEFINER RPCs
// (see web/app/pay/actions.ts), never directly.

export type PaymentIntentRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  idempotency_key: string;
  payment_type: string;
  provider: string | null;
  source_account_id: string | null;
  currency: string;
  amount_minor: number;
  fee_minor: number | null;
  recipient_kind: string | null;
  recipient_name: string | null;
  recipient_msisdn_normalized: string | null;
  recipient_msisdn_masked: string | null;
  merchant_code: string | null;
  meter_number: string | null;
  billing_reference: string | null;
  government_reference: string | null;
  service_code_id: string | null;
  ussd_string_redacted: string | null;
  note: string | null;
  category: string | null;
  budget_id: string | null;
  trusted_recipient_id: string | null;
  template_id: string | null;
  handoff_method: string;
  state: string;
  expires_at: string | null;
  linked_transaction_id: string | null;
  verified_at: string | null;
  manually_confirmed_at: string | null;
  manually_confirmed_by: string | null;
  session_fresh_at_creation: boolean | null;
  created_at: string;
  updated_at: string;
};

export type PaymentEventRow = {
  id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  actor_type: string;
  reason: string | null;
  created_at: string;
};

export type PaymentAttemptRow = {
  id: string;
  attempt_no: number;
  handoff_method: string;
  capability_outcome: string | null;
  started_at: string;
};

const INTENT_COLUMNS =
  "id, workspace_id, created_by, idempotency_key, payment_type, provider, source_account_id, currency, amount_minor, fee_minor, recipient_kind, recipient_name, recipient_msisdn_normalized, recipient_msisdn_masked, merchant_code, meter_number, billing_reference, government_reference, service_code_id, ussd_string_redacted, note, category, budget_id, trusted_recipient_id, template_id, handoff_method, state, expires_at, linked_transaction_id, verified_at, manually_confirmed_at, manually_confirmed_by, session_fresh_at_creation, created_at, updated_at";

/**
 * Lazily present a past-`expires_at`, still-open intent as `expired`
 * even before the cron sweep has run (so the UI is never stale). Does
 * not write — `expire_stale_payment_intents` is the authoritative writer.
 */
function withLazyExpiry(row: PaymentIntentRow): PaymentIntentRow {
  if (
    (row.state === "initiated" || row.state === "awaiting_verification") &&
    row.expires_at != null &&
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    return { ...row, state: "expired" };
  }
  return row;
}

export async function getPaymentActivity(opts: {
  state?: PaymentState;
  limit?: number;
} = {}): Promise<PaymentIntentRow[]> {
  const supabase = await supabaseSession();
  let q = supabase
    .from("payment_intents")
    .select(INTENT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.state) q = q.eq("state", opts.state);

  const { data, error } = await q;
  if (error) {
    console.error("getPaymentActivity failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as PaymentIntentRow[]).map(withLazyExpiry);
}

export async function getPaymentIntent(id: string): Promise<
  | {
      intent: PaymentIntentRow;
      events: PaymentEventRow[];
      attempts: PaymentAttemptRow[];
    }
  | null
> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_intents")
    .select(
      `${INTENT_COLUMNS},
       events:payment_events(id, event_type, from_state, to_state, actor_type, reason, created_at),
       attempts:payment_attempts(id, attempt_no, handoff_method, capability_outcome, started_at)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("getPaymentIntent failed:", error.message);
    return null;
  }
  const row = data as Record<string, unknown>;
  const events = ((row.events as PaymentEventRow[]) ?? []).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const attempts = ((row.attempts as PaymentAttemptRow[]) ?? []).sort(
    (a, b) => a.attempt_no - b.attempt_no,
  );
  return {
    intent: withLazyExpiry(row as unknown as PaymentIntentRow),
    events,
    attempts,
  };
}

export type TrustedRecipientRow = {
  id: string;
  display_name: string;
  kind: string;
  normalized_msisdn: string | null;
  msisdn_display: string | null;
  provider: string | null;
  merchant_code: string | null;
  account_reference: string | null;
  relationship: string | null;
  default_category: string | null;
  default_budget_id: string | null;
  expected_amount_min: number | null;
  expected_amount_max: number | null;
  trust_status: "saved" | "trusted_by_user";
  verification_note: string | null;
  created_at: string;
};

export async function getTrustedRecipients(): Promise<TrustedRecipientRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("trusted_recipients")
    .select(
      "id, display_name, kind, normalized_msisdn, msisdn_display, provider, merchant_code, account_reference, relationship, default_category, default_budget_id, expected_amount_min, expected_amount_max, trust_status, verification_note, created_at",
    )
    .order("display_name", { ascending: true });
  if (error) {
    console.error("getTrustedRecipients failed:", error.message);
    return [];
  }
  return (data ?? []) as TrustedRecipientRow[];
}

export type PaymentTemplateRow = {
  id: string;
  name: string;
  payment_type: string;
  provider: string | null;
  source_account_id: string | null;
  trusted_recipient_id: string | null;
  recipient_snapshot: Record<string, unknown>;
  default_amount_minor: number | null;
  currency: string;
  note: string | null;
  category: string | null;
  budget_id: string | null;
  service_code_id: string | null;
  created_at: string;
};

export async function getPaymentTemplates(): Promise<PaymentTemplateRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_templates")
    .select(
      "id, name, payment_type, provider, source_account_id, trusted_recipient_id, recipient_snapshot, default_amount_minor, currency, note, category, budget_id, service_code_id, created_at",
    )
    .order("name", { ascending: true });
  if (error) {
    console.error("getPaymentTemplates failed:", error.message);
    return [];
  }
  return (data ?? []) as PaymentTemplateRow[];
}

/** Distinct recent payees drawn from the last N intents (for the draft
 *  form's "recent" picker). */
export async function getRecentRecipients(limit = 6): Promise<
  { name: string; msisdn_masked: string | null; kind: string | null }[]
> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_intents")
    .select("recipient_name, recipient_msisdn_masked, recipient_kind, created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error || !data) return [];
  const seen = new Set<string>();
  const out: { name: string; msisdn_masked: string | null; kind: string | null }[] = [];
  for (const r of data as {
    recipient_name: string | null;
    recipient_msisdn_masked: string | null;
    recipient_kind: string | null;
  }[]) {
    const key = `${r.recipient_name ?? ""}|${r.recipient_msisdn_masked ?? ""}`;
    if (!r.recipient_name || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: r.recipient_name,
      msisdn_masked: r.recipient_msisdn_masked,
      kind: r.recipient_kind,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.has(state as PaymentState);
}

/**
 * Soft session-freshness check for the review screen. Never blocks in
 * Phase 2a — the caller uses this only to decide whether to show an
 * advisory notice. Returns true when the session's issued-at is within
 * PAYMENT_SESSION_FRESHNESS_MINUTES of now.
 */
export async function isSessionFresh(): Promise<boolean> {
  const supabase = await supabaseSession();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;
  // Supabase sessions carry expires_at (unix seconds) for a 1h token;
  // issued-at ≈ expires_at - expires_in.
  const expiresAt = session.expires_at ?? 0;
  const expiresIn = session.expires_in ?? 3600;
  const issuedAtMs = (expiresAt - expiresIn) * 1000;
  const ageMinutes = (Date.now() - issuedAtMs) / 60000;
  return ageMinutes <= paymentSessionFreshnessMinutes();
}
