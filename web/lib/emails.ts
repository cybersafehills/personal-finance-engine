import "server-only";
import { getResendClient } from "./resend";

// Every function here is best-effort: a failed or skipped send is logged
// and swallowed, never thrown back to the caller. None of these emails
// are load-bearing for the flow that triggers them (an invite still
// works via its link even if the email never arrives; a sign-in still
// succeeds even if its notification doesn't send) - only the delivery
// itself is Resend's job, not the underlying feature's correctness.

async function send(to: string, subject: string, html: string): Promise<boolean> {
  const client = getResendClient();
  if (!client) {
    console.error(`Skipped sending "${subject}" to ${to}: RESEND_API_KEY is not set.`);
    return false;
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
    return false;
  }

  try {
    const { error } = await client.emails.send({ from: fromEmail, to, subject, html });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Failed sending "${subject}" to ${to}:`, error);
    return false;
  }
}

export async function sendInviteEmail(params: {
  to: string;
  workspaceName: string;
  role: string;
  link: string;
}): Promise<{ ok: boolean }> {
  const ok = await send(
    params.to,
    `You've been invited to ${params.workspaceName}`,
    `
      <p>You've been invited to join <strong>${params.workspaceName}</strong> as ${params.role === "admin" ? "an admin" : `a ${params.role}`}.</p>
      <p><a href="${params.link}">Accept the invite</a></p>
      <p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>
    `,
  );
  return { ok };
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
