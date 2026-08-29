// Pure env-shape rules for the transactional-email config health check.
// No `server-only`, no imports - so it is Deno-testable
// (email-health-rules_test.ts). email-health.ts layers the live Resend
// domain lookup on top of this.

export type EmailConfigIssue = {
  level: "error" | "warn";
  code: string;
  message: string;
};

export type EmailEnv = {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  SITE_URL?: string;
  isProduction?: boolean;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function classifyEmailEnv(env: EmailEnv): {
  issues: EmailConfigIssue[];
  fromAddress: string | null;
  fromDomain: string | null;
} {
  const issues: EmailConfigIssue[] = [];
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim() || null;
  const siteUrl = env.SITE_URL?.trim();

  if (!apiKey) {
    issues.push({
      level: "error",
      code: "missing_api_key",
      message:
        "RESEND_API_KEY is not set — no transactional email (signup confirmation, invites, reports) will send.",
    });
  } else if (!apiKey.startsWith("re_")) {
    issues.push({
      level: "warn",
      code: "api_key_shape",
      message: "RESEND_API_KEY does not look like a Resend key (expected re_…).",
    });
  }

  const fromDomain = from && EMAIL_RE.test(from)
    ? from.slice(from.indexOf("@") + 1).toLowerCase()
    : null;

  if (!from) {
    issues.push({
      level: "error",
      code: "missing_from",
      message:
        "RESEND_FROM_EMAIL is not set — lib/emails.ts skips every send, and Supabase Auth SMTP has no sender.",
    });
  } else if (!EMAIL_RE.test(from)) {
    issues.push({
      level: "error",
      code: "from_not_email",
      message: `RESEND_FROM_EMAIL ("${from}") is not a valid email address.`,
    });
  } else if (/(^|\.)resend\.dev$/i.test(fromDomain ?? "")) {
    issues.push({
      level: "warn",
      code: "from_sandbox",
      message:
        "RESEND_FROM_EMAIL is a resend.dev sandbox sender — it only delivers to your own Resend account email, never real recipients.",
    });
  }

  if (!siteUrl) {
    issues.push({
      level: "error",
      code: "missing_site_url",
      message:
        "SITE_URL is not set — every emailed link (confirmation, password reset, invite) is built from it.",
    });
  } else if (!/^https?:\/\//.test(siteUrl)) {
    issues.push({
      level: "warn",
      code: "site_url_shape",
      message: `SITE_URL ("${siteUrl}") should be an absolute http(s) URL.`,
    });
  } else if (
    env.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(siteUrl)
  ) {
    issues.push({
      level: "error",
      code: "site_url_localhost_in_prod",
      message:
        `SITE_URL ("${siteUrl}") points at localhost in a production build — emailed links will be dead.`,
    });
  }

  return { issues, fromAddress: from, fromDomain };
}
