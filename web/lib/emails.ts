import "server-only";
import { getResendClient } from "./resend";
import { formatRwf, formatSignedRwf } from "./format";

// Every function here is best-effort: a failed or skipped send is logged
// and swallowed, never thrown back to the caller. None of these emails
// are load-bearing for the flow that triggers them (an invite still
// works via its link even if the email never arrives; a sign-in still
// succeeds even if its notification doesn't send) - only the delivery
// itself is Resend's job, not the underlying feature's correctness.

type SendResult = { ok: true; providerMessageId: string | null } | {
  ok: false;
  errorCode: string;
};

/** Recipient domain only - never log a full recipient address. */
function recipientDomain(to: string): string {
  const at = to.lastIndexOf("@");
  return at >= 0 ? to.slice(at + 1).toLowerCase() : "(none)";
}

/**
 * One structured line per send attempt, safe to ship to logs: subject,
 * recipient *domain* (not the address), outcome, and the Resend message
 * id or a short error tag. A failed invite / confirmation is invisible
 * without this (every send here is otherwise best-effort and swallowed).
 */
function logSend(
  subject: string,
  to: string,
  outcome: "sent" | "skipped" | "failed",
  detail: { messageId?: string | null; code?: string },
): void {
  const parts = [
    `outcome=${outcome}`,
    `domain=${recipientDomain(to)}`,
    `subject=${JSON.stringify(subject)}`,
  ];
  if (detail.messageId) parts.push(`messageId=${detail.messageId}`);
  if (detail.code) parts.push(`code=${detail.code}`);
  const line = `[email-send] ${parts.join(" ")}`;
  if (outcome === "sent") console.info(line);
  else console.error(line);
}

/**
 * `text` is optional (existing short notification emails don't bother -
 * Resend/mail clients synthesize a reasonable plain-text view from html
 * when it's omitted) but the daily report email always supplies one
 * explicitly (master prompt §24/§55: HTML + a genuine plain-text
 * alternative), since it's long enough that an auto-stripped fallback
 * would read poorly.
 */
async function send(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<SendResult> {
  const client = getResendClient();
  if (!client) {
    console.error(
      `Skipped sending "${subject}" to ${to}: RESEND_API_KEY is not set.`,
    );
    logSend(subject, to, "skipped", { code: "missing_api_key" });
    return { ok: false, errorCode: "provider_not_configured" };
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    console.error(
      `Skipped sending "${subject}" to ${to}: RESEND_FROM_EMAIL is not set. ` +
        "Resend's onboarding@resend.dev sandbox sender only delivers to " +
        "your own verified Resend account email, not real recipients - " +
        "verify a domain in Resend and set RESEND_FROM_EMAIL to an " +
        "address on it.",
    );
    logSend(subject, to, "skipped", { code: "missing_from" });
    return { ok: false, errorCode: "provider_not_configured" };
  }

  try {
    const { data, error } = await client.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
      text,
    });
    if (error) throw error;
    logSend(subject, to, "sent", { messageId: data?.id ?? null });
    return { ok: true, providerMessageId: data?.id ?? null };
  } catch (error) {
    console.error(`Failed sending "${subject}" to ${to}:`, error);
    const code = error instanceof Error && error.name ? error.name : "send_failed";
    logSend(subject, to, "failed", { code });
    return { ok: false, errorCode: "send_failed" };
  }
}

export async function sendInviteEmail(params: {
  to: string;
  workspaceName: string;
  role: string;
  link: string;
}): Promise<{ ok: boolean }> {
  const result = await send(
    params.to,
    `You've been invited to ${params.workspaceName}`,
    `
      <p>You've been invited to join <strong>${params.workspaceName}</strong> as ${
      params.role === "admin" ? "an admin" : `a ${params.role}`
    }.</p>
      <p><a href="${params.link}">Accept the invite</a></p>
      <p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>
    `,
  );
  return { ok: result.ok };
}

export async function sendNewSignInEmail(to: string): Promise<void> {
  await send(
    to,
    "New sign-in to your account",
    `
      <p>Your account was just signed in to.</p>
      <p>If this was you, no action is needed. If it wasn't, reset your
      password right away from the sign-in page's "Forgot your
      password?" link.</p>
    `,
  );
}

export async function sendLockoutAlertEmail(to: string): Promise<void> {
  await send(
    to,
    "Repeated failed sign-in attempts on your account",
    `
      <p>We blocked further sign-in attempts on your account after
      several failed tries in a short window.</p>
      <p>If this was you, wait a few minutes and try again. If it
      wasn't, your password may be compromised - reset it from the
      sign-in page's "Forgot your password?" link.</p>
    `,
  );
}

export type DailyReportEmailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: string };

/**
 * Renders and sends the morning report email. Takes only already-computed
 * numbers/strings from a persisted report_runs.report_payload
 * (web/lib/report-generation.ts / report-math.ts) - this function performs
 * no financial calculation of its own (master prompt §24: the email is a
 * renderer of the structured snapshot, never an independent calculator).
 *
 * Deliberately no PDF attachment (master prompt §38/§26.3 architecture
 * decision) - a short summary plus a link to the full in-app report.
 * Includes a genuine plain-text alternative (not Resend's auto-stripped
 * html fallback) since this email is long enough for that to read poorly.
 */
export async function sendDailyReportEmail(params: {
  to: string;
  dateLabel: string;
  reportUrl: string;
  closingBalanceRwf: number | null;
  moneyReceivedRwf: number;
  moneySpentRwf: number;
  feesRwf: number;
  netMovementRwf: number;
  /** Pre-formatted one-line budget observations, e.g. "Essentials: 82% of target used." Empty when no active budget. */
  budgetSummaryLines: string[];
  /** Pre-formatted one-line alert sentences (from report-math.ts's deterministic alerts). Empty when nothing notable. */
  watchOutLines: string[];
}): Promise<DailyReportEmailResult> {
  const closingBalanceText = params.closingBalanceRwf !== null
    ? formatRwf(params.closingBalanceRwf)
    : "—";

  const row = (label: string, value: string, bold = false) => `
    <tr>
      <td style="padding:6px 0;color:#666666;font-size:14px;">${label}</td>
      <td style="padding:6px 0;text-align:right;font-size:14px;${
    bold ? "font-weight:600;color:#111111;" : "color:#111111;"
  }">${value}</td>
    </tr>`;

  const listSection = (title: string, lines: string[]) =>
    lines.length === 0 ? "" : `
      <p style="margin:20px 0 4px;font-size:13px;font-weight:600;color:#111111;text-transform:uppercase;letter-spacing:0.03em;">${title}</p>
      <ul style="margin:0;padding-left:18px;font-size:14px;color:#333333;">
        ${
      lines.map((line) => `<li style="margin-bottom:4px;">${line}</li>`).join(
        "",
      )
    }
      </ul>`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;color:#111111;">
      <p style="font-size:15px;">Good morning,</p>
      <h2 style="font-size:18px;margin:4px 0 12px;">Yesterday at a glance — ${params.dateLabel}</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${row("Closing balance", closingBalanceText, true)}
        ${row("Money received", formatRwf(params.moneyReceivedRwf))}
        ${row("Money spent", formatRwf(params.moneySpentRwf))}
        ${row("Fees", formatRwf(params.feesRwf))}
        ${row("Net movement", formatSignedRwf(params.netMovementRwf), true)}
      </table>
      ${listSection("Budget status", params.budgetSummaryLines)}
      ${listSection("Watch-outs", params.watchOutLines)}
      <p style="margin-top:24px;">
        <a href="${params.reportUrl}" style="display:inline-block;background:#111111;color:#ffffff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">View full report</a>
      </p>
      <p style="margin-top:32px;font-size:12px;color:#999999;">
        This is an automated OneLedger daily report. Manage delivery any time in Settings → Daily reports.
      </p>
    </div>`;

  const text = [
    `Good morning,`,
    ``,
    `Yesterday at a glance — ${params.dateLabel}`,
    `Closing balance: ${closingBalanceText}`,
    `Money received: ${formatRwf(params.moneyReceivedRwf)}`,
    `Money spent: ${formatRwf(params.moneySpentRwf)}`,
    `Fees: ${formatRwf(params.feesRwf)}`,
    `Net movement: ${formatSignedRwf(params.netMovementRwf)}`,
    ...(params.budgetSummaryLines.length > 0
      ? [
        "",
        "Budget status:",
        ...params.budgetSummaryLines.map((l) => `- ${l}`),
      ]
      : []),
    ...(params.watchOutLines.length > 0
      ? ["", "Watch-outs:", ...params.watchOutLines.map((l) => `- ${l}`)]
      : []),
    ``,
    `View full report: ${params.reportUrl}`,
    ``,
    `Manage delivery any time in Settings → Daily reports.`,
  ].join("\n");

  const result = await send(
    params.to,
    `Your OneLedger report for ${params.dateLabel}`,
    html,
    text,
  );
  return result.ok
    ? { ok: true, providerMessageId: result.providerMessageId }
    : { ok: false, errorCode: result.errorCode };
}
