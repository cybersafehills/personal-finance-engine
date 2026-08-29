import "server-only";
import { getResendClient } from "./resend";
import {
  classifyEmailEnv,
  type EmailConfigIssue,
} from "./email-health-rules";

// Config health for the transactional-email path (signup confirmation via
// Supabase Auth SMTP, plus invites / sign-in notices / daily reports via
// lib/emails.ts). A misconfigured RESEND_FROM_EMAIL or an unverified
// sending domain fails *silently* for real recipients - this surfaces it.
// Read-only: never sends anything. Pure env rules live in
// ./email-health-rules.ts (Deno-tested).

export type { EmailConfigIssue } from "./email-health-rules";

export type EmailConfigReport = {
  /** No error-level issues. Warn-level issues can still be present. */
  ok: boolean;
  issues: EmailConfigIssue[];
  fromAddress: string | null;
  fromDomain: string | null;
  /** null = not checked (no API key, sandbox sender, or lookup failed). */
  domainVerified: boolean | null;
};

/**
 * The pure env check plus, when a Resend key is present and the sender is
 * a real domain, a live lookup of that domain's verification status in
 * the Resend account.
 */
export async function checkEmailConfig(): Promise<EmailConfigReport> {
  const { issues, fromAddress, fromDomain } = classifyEmailEnv({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    SITE_URL: process.env.SITE_URL,
    isProduction: process.env.NODE_ENV === "production",
  });

  let domainVerified: boolean | null = null;
  const client = getResendClient();
  const sandbox = issues.some((i) => i.code === "from_sandbox");

  if (client && fromDomain && !sandbox) {
    try {
      const res = (await client.domains.list()) as {
        data?:
          | { data?: Array<{ name?: string; status?: string }> }
          | Array<{ name?: string; status?: string }>;
      };
      const list = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
      const match = list.find((d) => d.name?.toLowerCase() === fromDomain);

      if (!match) {
        issues.push({
          level: "error",
          code: "domain_not_in_account",
          message:
            `The sending domain ${fromDomain} is not in this Resend account. Add and verify it, or delivery to real recipients fails.`,
        });
      } else {
        domainVerified = match.status === "verified";
        if (!domainVerified) {
          issues.push({
            level: "error",
            code: "domain_unverified",
            message:
              `The sending domain ${fromDomain} is in Resend but its status is "${
                match.status ?? "unknown"
              }", not "verified".`,
          });
        }
      }
    } catch {
      issues.push({
        level: "warn",
        code: "domain_lookup_failed",
        message:
          "Could not query Resend for the sending domain's status (API error) — verify it manually in the Resend dashboard.",
      });
    }
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    fromAddress,
    fromDomain,
    domainVerified,
  };
}
