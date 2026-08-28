// Phase V PR3: pure helpers for the email-outbox drainer. index.ts wires
// these to the real Supabase client, Resend, and Deno.env; the tests
// wire them to plain values.

export type DeliveryConfig =
  | { enabled: true; apiKey: string; from: string }
  | { enabled: false; reason: string };

const DEFAULT_FROM = "OneLedger <notifications@oneledger.app>";

/**
 * Email delivery is dark unless BOTH switches are set, matching this
 * repo's other opt-in integrations (SCAN_TO_PAY_ENABLED etc.):
 *   NOTIFICATION_EMAIL_ENABLED = "true"
 *   RESEND_API_KEY             = <a Resend API key>
 * NOTIFICATION_EMAIL_FROM overrides the sender.
 */
export function deliveryConfig(
  get: (key: string) => string | undefined,
): DeliveryConfig {
  if (get("NOTIFICATION_EMAIL_ENABLED") !== "true") {
    return {
      enabled: false,
      reason: "NOTIFICATION_EMAIL_ENABLED is not 'true'",
    };
  }
  const apiKey = (get("RESEND_API_KEY") ?? "").trim();
  if (!apiKey) {
    return { enabled: false, reason: "RESEND_API_KEY is not set" };
  }
  return {
    enabled: true,
    apiKey,
    from: (get("NOTIFICATION_EMAIL_FROM") ?? "").trim() || DEFAULT_FROM,
  };
}

export type PendingEmail = {
  id: string;
  email: string;
  title: string;
  body: string | null;
};

export type ResendRequest = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};

/** Maps one outbox row to a Resend `POST /emails` body. */
export function buildResendRequest(
  row: PendingEmail,
  from: string,
): ResendRequest {
  const body = (row.body ?? "").trim();
  return {
    from,
    to: [row.email],
    subject: row.title,
    text: body.length > 0 ? `${row.title}\n\n${body}` : row.title,
  };
}

export type SendOutcome = { id: string; ok: boolean; error?: string };

export type DrainSummary = {
  configured: boolean;
  reason?: string;
  considered: number;
  sent: number;
  failed: number;
};

export function summarize(
  configured: boolean,
  considered: number,
  outcomes: SendOutcome[],
  reason?: string,
): DrainSummary {
  return {
    configured,
    ...(reason ? { reason } : {}),
    considered,
    sent: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
  };
}
