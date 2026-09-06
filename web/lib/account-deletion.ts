import "server-only";

import { supabaseSession } from "./supabase-session-server";

// Account deletion request state (ADR 0016, audit F12). Dark behind
// ACCOUNT_DELETION_ENABLED - when off, the /settings/privacy/data page
// still offers data export (always safe) but hides the delete flow.
//
// The request side (schedule / cancel, 30-day grace) is gated by
// ACCOUNT_DELETION_ENABLED. The irreversible erasure that the
// process-account-deletions cron performs is gated separately by
// ACCOUNT_DELETION_EXECUTE_ENABLED (ADR 0016 §3) - the request flow is
// usable without anything actually being erased until an operator flips
// the second switch and wires the scheduler.

export function isAccountDeletionEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_ENABLED === "true";
}

export function isAccountDeletionExecuteEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_EXECUTE_ENABLED === "true";
}

export type AccountDeletionRequest = {
  status: "scheduled" | "cancelled" | "completed";
  requestedAt: string;
  scheduledFor: string;
  cancelledAt: string | null;
};

export async function getAccountDeletionRequest(): Promise<
  AccountDeletionRequest | null
> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("status, requested_at, scheduled_for, cancelled_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    status: data.status as AccountDeletionRequest["status"],
    requestedAt: data.requested_at as string,
    scheduledFor: data.scheduled_for as string,
    cancelledAt: (data.cancelled_at as string | null) ?? null,
  };
}
