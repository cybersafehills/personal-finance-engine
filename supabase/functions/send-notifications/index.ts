import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildResendRequest,
  deliveryConfig,
  type PendingEmail,
  type SendOutcome,
  summarize,
} from "./lib.ts";

// Phase V PR3: the email-outbox drainer. Reads the oldest unsent
// channel='email' notifications (Phase V PR1), sends each via Resend, and
// stamps delivered_at. Dark unless NOTIFICATION_EMAIL_ENABLED === "true"
// AND RESEND_API_KEY is set - a missing config is a clean no-op, never an
// error. Intended to run on a schedule (see config.toml) but is also
// safe to invoke manually; every row it fails to send is simply retried
// on the next run.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const BATCH_LIMIT = 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async () => {
  const config = deliveryConfig((k) => Deno.env.get(k) ?? undefined);

  if (!config.enabled) {
    console.log(
      JSON.stringify({ event: "email_drain_skipped", reason: config.reason }),
    );
    return json({ ok: true, ...summarize(false, 0, [], config.reason) });
  }

  const { data: rows, error } = await supabase.rpc(
    "pending_notification_emails",
    { p_limit: BATCH_LIMIT },
  );

  if (error) {
    console.error("pending_notification_emails failed:", error);
    return json({ ok: false, error: "outbox_read_failed" }, 500);
  }

  const pending = (rows ?? []) as PendingEmail[];
  if (pending.length === 0) {
    return json({ ok: true, ...summarize(true, 0, []) });
  }

  const outcomes: SendOutcome[] = [];
  for (const row of pending) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildResendRequest(row, config.from)),
      });
      if (res.ok) {
        outcomes.push({ id: row.id, ok: true });
      } else {
        const detail = await res.text();
        outcomes.push({
          id: row.id,
          ok: false,
          error: `resend ${res.status}: ${detail.slice(0, 200)}`,
        });
      }
    } catch (e) {
      outcomes.push({
        id: row.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const deliveredIds = outcomes.filter((o) => o.ok).map((o) => o.id);
  if (deliveredIds.length > 0) {
    const { error: ackError } = await supabase.rpc(
      "mark_notification_emails_delivered",
      { p_ids: deliveredIds },
    );
    if (ackError) {
      // The rows stay pending and get retried; a duplicate send next run
      // is the acceptable failure mode here, not a lost notification.
      console.error("mark_notification_emails_delivered failed:", ackError);
    }
  }

  const summary = summarize(true, pending.length, outcomes);
  console.log(JSON.stringify({ event: "email_drain", ...summary }));
  for (const o of outcomes) {
    if (!o.ok) {
      console.error(`email send failed for ${o.id}: ${o.error}`);
    }
  }

  return json({ ok: true, ...summary });
});
