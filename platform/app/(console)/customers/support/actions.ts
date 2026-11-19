"use server";

import { requireSession } from "../../../../lib/console/access";
import { friendlyError } from "../../../../lib/console/errors";
import { back } from "../../../../lib/console/flash";

const CATEGORIES = ["account_access", "subscription_billing", "payment_issue", "transaction_import", "wallet_configuration", "application_malfunction", "security_concern", "feature_assistance"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["open", "in_progress", "waiting", "escalated", "resolved", "closed"];
const UUID = /^[0-9a-f-]{36}$/i;

const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? "").slice(0, max);

export async function createTicket(form: FormData) {
  const session = await requireSession();
  const category = str(form, "category", 40);
  const priority = str(form, "priority", 10);
  if (!CATEGORIES.includes(category) || !PRIORITIES.includes(priority)) back("/customers/support", "err", "Choose a category and priority.");
  const customer = str(form, "customer_id", 36).trim();
  const { data, error } = await session.supabase.rpc("console_support_create", {
    p_subject: str(form, "subject", 160),
    p_category: category,
    p_priority: priority,
    p_customer_id: UUID.test(customer) ? customer : null,
    p_body: str(form, "body") || null,
  });
  if (error) back("/customers/support", "err", friendlyError(error.message));
  back(`/customers/support/${data}`, "ok", "Ticket logged.");
}

export async function addNote(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36);
  if (!UUID.test(id)) back("/customers/support", "err", "Unknown ticket.");
  const { error } = await session.supabase.rpc("console_support_add_note", { p_id: id, p_body: str(form, "body") });
  back(`/customers/support/${id}`, error ? "err" : "ok", error ? friendlyError(error.message) : "Note added.");
}

export async function setStatus(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36);
  const status = str(form, "status", 20);
  if (!UUID.test(id) || !STATUSES.includes(status)) back("/customers/support", "err", "Unknown ticket or status.");
  const { error } = await session.supabase.rpc("console_support_set_status", { p_id: id, p_status: status, p_note: str(form, "note", 500) || null });
  back(`/customers/support/${id}`, error ? "err" : "ok", error ? friendlyError(error.message) : `Status set to ${status.replace("_", " ")}.`);
}

export async function assignTicket(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36);
  const to = str(form, "assignee", 36);
  if (!UUID.test(id)) back("/customers/support", "err", "Unknown ticket.");
  const { error } = await session.supabase.rpc("console_support_assign", { p_id: id, p_assignee: UUID.test(to) ? to : null });
  back(`/customers/support/${id}`, error ? "err" : "ok", error ? friendlyError(error.message) : "Assignment updated.");
}
