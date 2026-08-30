import { createClient } from "npm:@supabase/supabase-js@2";
import {
  authorizeDrainRequest,
  buildResendRequest,
  deliveryConfig,
  type PendingEmail,
  resendIdempotencyKey,
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

Deno.serve(async (request: Request) => {
  const getEnv = (key: string) => Deno.env.get(key) ?? undefined;
  const authorization = authorizeDrainRequest(request, getEnv);
  if (authorization === "method_not_allowed") {
    return json({ ok: false, error: authorization }, 405);
  }
  if (authorization !== "ok") {
    if (authorization === "secret_not_configured") {
      console.error("send-notifications: NOTIFICATION_CRON_SECRET is not set");
    }
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const config = deliveryConfig(getEnv);

  if (!config.enabled) {
    console.log(
      JSON.stringify({ event: "email_drain_skipped", reason: config.reason }),
    );
    return json({ ok: true, ...summarize(false, 0, [], config.reason) });
  }

  const claimToken = crypto.randomUUID();
  const { data: rows, error } = await supabase.rpc(
    "claim_notification_emails",
    { p_claim_token: claimToken, p_limit: BATCH_LIMIT, p_lease_seconds: 300 },
  );

  if (error) {
    console.error("claim_notification_emails failed:", error);
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
          "Idempotency-Key": resendIdempotencyKey(row.id),
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
      "ack_notification_email_claim",
      { p_claim_token: claimToken, p_ids: deliveredIds },
    );
    if (ackError) {
      // The lease eventually expires. Resend's stable Idempotency-Key makes
      // a retry safe even if the provider accepted mail before this ack.
      console.error("ack_notification_email_claim failed:", ackError);
    }
  }

  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length > 0) {
    const { error: releaseError } = await supabase.rpc(
      "release_notification_email_claim",
      {
        p_claim_token: claimToken,
        p_ids: failed.map((o) => o.id),
        p_error: failed.map((o) => o.error ?? "unknown send failure").join(
          "; ",
        ),
      },
    );
    if (releaseError) {
      // A failed release delays retry only until the lease expires.
      console.error("release_notification_email_claim failed:", releaseError);
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
