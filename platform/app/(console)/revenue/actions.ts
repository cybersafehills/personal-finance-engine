"use server";

import { requireSession } from "../../../lib/console/access";
import { friendlyError } from "../../../lib/console/errors";
import { back } from "../../../lib/console/flash";

const UUID = /^[0-9a-f-]{36}$/i;
const PLANS = ["personal", "vip", "business"];
const INTERVALS = ["monthly", "yearly"];
const PROVIDERS = ["mtn_momo", "airtel_money", "bank", "card", "manual"];
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").slice(0, max);
const SUBS = "/revenue/subscriptions";

export async function createSubscription(form: FormData) {
  const session = await requireSession();
  const plan = str(form, "plan", 20), interval = str(form, "interval", 10);
  const ref = str(form, "workspace_ref", 40).trim();
  if (!PLANS.includes(plan) || !INTERVALS.includes(interval)) back(SUBS, "err", "Choose a plan and billing interval.");
  const found = await session.supabase.rpc("console_billing_workspace_lookup", { p_ref: ref });
  const hits = (found.data ?? []) as { id: string; has_live_subscription: boolean }[];
  if (found.error) back(SUBS, "err", friendlyError(found.error.message));
  if (hits.length === 0) back(SUBS, "err", "No workspace matches that reference. Enter at least 6 characters of its ID.");
  if (hits.length > 1) back(SUBS, "err", "More than one workspace matches. Enter more characters of the ID.");
  const { data, error } = await session.supabase.rpc("console_billing_create_subscription", { p_workspace: hits[0].id, p_plan: plan, p_interval: interval });
  if (error) back(SUBS, "err", friendlyError(error.message));
  back(`${SUBS}/${data}`, "ok", "Subscription created. It becomes active when the first payment settles.");
}

export async function recordPayment(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36), provider = str(form, "provider", 20), outcome = str(form, "outcome", 12);
  if (!UUID.test(id) || !PROVIDERS.includes(provider)) back(SUBS, "err", "Unknown subscription or provider.");
  const { data, error } = await session.supabase.rpc("console_billing_record_payment", { p_subscription: id, p_provider: provider, p_reference: str(form, "reference", 100), p_outcome: outcome });
  const path = `${SUBS}/${id}`;
  if (error) back(path, "err", friendlyError(error.message));
  const r = data as { duplicate: boolean; status: string };
  back(path, "ok", r.duplicate ? "That reference was already recorded; nothing changed." : `Payment recorded as ${r.status}.`);
}

export async function settlePayment(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36), outcome = str(form, "outcome", 12), ret = str(form, "return", 100) || "/revenue/billing";
  if (!UUID.test(id)) back(ret.startsWith("/revenue/") ? ret : "/revenue/billing", "err", "Unknown payment.");
  const { error } = await session.supabase.rpc("console_billing_settle_payment", { p_payment: id, p_outcome: outcome });
  back(ret.startsWith("/revenue/") ? ret : "/revenue/billing", error ? "err" : "ok", error ? friendlyError(error.message) : `Payment marked ${outcome}.`);
}

export async function setReconciliation(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36), state = str(form, "state", 20);
  if (!UUID.test(id)) back("/revenue/billing", "err", "Unknown payment.");
  const { error } = await session.supabase.rpc("console_billing_set_reconciliation", { p_payment: id, p_state: state, p_note: str(form, "note") || null });
  back("/revenue/billing", error ? "err" : "ok", error ? friendlyError(error.message) : `Reconciliation set to ${state}.`);
}

export async function cancelSubscription(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36);
  if (!UUID.test(id)) back(SUBS, "err", "Unknown subscription.");
  const atEnd = str(form, "when", 10) !== "now";
  const { data, error } = await session.supabase.rpc("console_billing_cancel", { p_subscription: id, p_at_period_end: atEnd, p_reason: str(form, "reason") });
  back(`${SUBS}/${id}`, error ? "err" : "ok", error ? friendlyError(error.message) : data === "cancelled" ? "Subscription cancelled." : "Cancellation scheduled for the end of the paid period.");
}

export async function rollPeriods() {
  const session = await requireSession();
  const { data, error } = await session.supabase.rpc("console_billing_roll_periods");
  if (error) back(SUBS, "err", friendlyError(error.message));
  const r = data as { cancelled: number; past_due: number; expired: number };
  back(SUBS, "ok", `Periods applied: ${r.past_due} past due, ${r.expired} expired, ${r.cancelled} cancelled.`);
}

const REF = "/revenue/refunds";
export async function requestRefund(form: FormData) {
  const session = await requireSession();
  const id = str(form, "payment_id", 36), amount = Number(str(form, "amount", 10));
  if (!UUID.test(id) || !Number.isInteger(amount) || amount <= 0) back(REF, "err", "Enter a payment and a whole-franc amount.");
  const { error } = await session.supabase.rpc("console_billing_refund_request", { p_payment: id, p_amount: amount, p_reason: str(form, "reason") });
  back(REF, error ? "err" : "ok", error ? friendlyError(error.message) : "Refund requested. A Finance Administrator other than you must approve it.");
}

export async function decideRefund(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36), decision = str(form, "decision", 10);
  if (!UUID.test(id)) back(REF, "err", "Unknown refund.");
  const { error } = await session.supabase.rpc("console_billing_refund_decide", { p_refund: id, p_decision: decision, p_note: str(form, "note") || null });
  back(REF, error ? "err" : "ok", error ? friendlyError(error.message) : decision === "approve" ? "Refund approved. Pay it out, then record the payout reference." : "Refund rejected.");
}

export async function processRefund(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36);
  if (!UUID.test(id)) back(REF, "err", "Unknown refund.");
  const { error } = await session.supabase.rpc("console_billing_refund_process", { p_refund: id, p_payout_reference: str(form, "payout_reference", 100) });
  back(REF, error ? "err" : "ok", error ? friendlyError(error.message) : "Refund recorded as paid out.");
}
