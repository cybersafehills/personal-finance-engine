import "server-only";

import { supabaseSession } from "./supabase-session-server";

// Account deletion request state (ADR 0016, audit F12). Dark behind
// ACCOUNT_DELETION_ENABLED - when off, the /settings/privacy/data page
// still offers data export (always safe) but hides the delete flow.
//
// This module is the request side only: schedule / cancel with a 30-day
// grace window. The irreversible erasure is a separate follow-up.

export function isAccountDeletionEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_ENABLED === "true";
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
