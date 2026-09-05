"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verificationFailureStatus } from "../../../lib/auth-callback";
import { internalRedirectPath } from "../../../lib/internal-redirect";
import {
  decodePendingValue,
  PENDING_VERIFICATION_EMAIL_COOKIE,
  PENDING_VERIFICATION_NEXT_COOKIE,
  signupConfirmationNext,
  VERIFICATION_RESEND_AT_COOKIE,
} from "../../../lib/pending-verification";
import { supabaseSession } from "../../../lib/supabase-session-server";

// The one place a signup confirmation token is actually spent. Deliberately
// a Server Action invoked from a button click (ConfirmEmailPanel), never
// logic that runs on the /auth/confirm page's own GET load: corporate
// mail-security gateways and link scanners (Proofpoint, Mimecast, Safe
// Links, etc.) prefetch every link in an email to scan it, and a GET
// handler that calls verifyOtp burns the one-time token on that automated
// fetch - the real person then clicks the link and lands on "that link is
// no longer available" without ever having done anything wrong. Requiring
// a user gesture (this action, a POST) before verifyOtp runs means a
// scanner's GET is inert.
//
// The eventual destination travels via PENDING_VERIFICATION_NEXT_COOKIE
// (set at signup/resend time), not a `next` URL param on the email link
// itself - Supabase's {{ .RedirectTo }} template variable would otherwise
// need to carry a second, nested URL, and emailRedirectTo has to stay one
// fixed, allow-listable path regardless of where a given signup started.
// If the cookie isn't there (a different browser/app opened the link),
// this just falls back to onboarding, same as a normal first-run signup.
export async function confirmSignupEmail(tokenHash: string): Promise<void> {
  const cookieStore = await cookies();
  const storedNext = decodePendingValue(
    cookieStore.get(PENDING_VERIFICATION_NEXT_COOKIE)?.value,
  );
  const next = internalRedirectPath(
    signupConfirmationNext(storedNext ?? "/"),
    "/onboarding/profile",
  );

  const supabase = await supabaseSession();
  const { error } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });

  if (error) {
    redirect(`/verify-email?status=${verificationFailureStatus(error)}`);
  }

  cookieStore.delete(PENDING_VERIFICATION_EMAIL_COOKIE);
  cookieStore.delete(PENDING_VERIFICATION_NEXT_COOKIE);
  cookieStore.delete(VERIFICATION_RESEND_AT_COOKIE);

  redirect(next);
}
