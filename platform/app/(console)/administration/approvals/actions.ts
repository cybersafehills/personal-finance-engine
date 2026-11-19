"use server";

import { requireSession } from "../../../../lib/console/access";
import { FAILURE_REASONS, friendlyError } from "../../../../lib/console/errors";
import { back } from "../../../../lib/console/flash";

const UUID = /^[0-9a-f-]{36}$/i;
const KINDS = ["staff_grant", "staff_suspend", "staff_reactivate", "staff_role_change"];
const ROLES = ["platform_owner", "platform_admin", "finance_admin", "security_admin", "support_agent", "read_only_analyst"];
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").slice(0, max);
const BASE = "/administration/approvals";

export async function requestChange(form: FormData) {
  const session = await requireSession();
  const kind = str(form, "kind", 20);
  const role = str(form, "role", 20);
  const email = str(form, "email", 200).trim();
  if (!KINDS.includes(kind)) back(BASE, "err", "Choose what you are requesting.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back(BASE, "err", "Enter the person's account email.");
  const needsRole = kind === "staff_grant" || kind === "staff_role_change";
  if (needsRole && !ROLES.includes(role)) back(BASE, "err", "Choose a role.");
  const { error } = await session.supabase.rpc("console_approval_request", {
    p_kind: kind, p_target_email: email, p_new_role: needsRole ? role : null, p_reason: str(form, "reason"),
  });
  back(BASE, error ? "err" : "ok", error ? friendlyError(error.message) : "Request submitted. A different owner must approve it.");
}

export async function decide(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36);
  const decision = str(form, "decision", 10);
  if (!UUID.test(id) || !["approve", "reject"].includes(decision)) back(BASE, "err", "Unknown request.");
  const { data, error } = await session.supabase.rpc("console_approval_decide", { p_id: id, p_decision: decision, p_note: str(form, "note") || null });
  if (error) back(BASE, "err", friendlyError(error.message));
  const r = data as { status: string; reason?: string };
  if (r.status === "failed") back(BASE, "err", `Not applied. ${FAILURE_REASONS[r.reason ?? ""] ?? "The change could not be applied."}`);
  back(BASE, "ok", r.status === "approved" ? "Approved and applied." : "Request rejected.");
}

export async function cancelRequest(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36);
  if (!UUID.test(id)) back(BASE, "err", "Unknown request.");
  const { error } = await session.supabase.rpc("console_approval_cancel", { p_id: id });
  back(BASE, error ? "err" : "ok", error ? friendlyError(error.message) : "Request cancelled.");
}
