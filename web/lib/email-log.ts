import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Best-effort audit sink for transactional-email attempts
// (email_send_log, 20261007000000_email_send_log.sql). Lazy service-role
// client built the same way lib/resend.ts builds its own - it must NOT
// throw at import time, since lib/emails.ts (which calls this) is imported
// from the login Server Action.

let cached: SupabaseClient | null | undefined;

function client(): SupabaseClient | null {
  if (cached === undefined) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    cached = url && key
      ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      : null;
  }
  return cached;
}

export type EmailSendRecord = {
  outcome: "sent" | "skipped" | "failed";
  category: string;
  /** Domain only - never a full recipient address. */
  recipientDomain: string;
  workspaceId?: string | null;
  providerMessageId?: string | null;
  errorCode?: string | null;
};

/**
 * Writes one email_send_log row. Never throws and never blocks the send:
 * a missing service-role key or an insert error is swallowed (logged),
 * exactly like the sends themselves.
 */
export async function recordEmailSend(rec: EmailSendRecord): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    const { error } = await c.from("email_send_log").insert({
      outcome: rec.outcome,
      category: rec.category,
      recipient_domain: rec.recipientDomain,
      workspace_id: rec.workspaceId ?? null,
      provider_message_id: rec.providerMessageId ?? null,
      error_code: rec.errorCode ?? null,
    });
    if (error) console.error("[email-send] audit insert failed:", error.message);
  } catch (e) {
    console.error("[email-send] audit insert threw:", e);
  }
}
