"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "../../lib/supabase-session-server";
import { supabaseServer } from "../../lib/supabase-server";
import { sendLockoutAlertEmail, sendNewSignInEmail } from "../../lib/emails";
import { internalRedirectPath } from "../../lib/internal-redirect";

export type AuthActionResult = { ok: true } | { ok: false; error: string };

// Defense-in-depth beyond Supabase's own per-IP rate limit
// (auth.rate_limit.sign_in_sign_ups in supabase/config.toml), which does
// nothing against a targeted attempt against one account spread across
// many IPs. See supabase/migrations/20260826000000_auth_login_lockout.sql.
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_WINDOW = "15 minutes";

export async function signIn(
  email: string,
  password: string,
  next: string,
): Promise<AuthActionResult> {
  const privileged = supabaseServer();

  const { data: failedCount, error: lockoutCheckError } = await privileged.rpc(
    "recent_failed_login_count",
    { p_email: email, p_window: LOCKOUT_WINDOW },
  );

  if (!lockoutCheckError && (failedCount ?? 0) >= LOCKOUT_THRESHOLD) {
    return {
      ok: false,
      error: "Too many attempts. Try again in a few minutes.",
    };
  }

  const supabase = await supabaseSession();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Awaited (not fire-and-forget): a serverless invocation can be frozen
  // right after the response is sent, which would silently drop an
  // un-awaited write and undermine the lockout it's meant to feed.
  await privileged.rpc("record_login_attempt", {
    p_email: email,
    p_succeeded: !error,
  });

  if (error) {
    // This exact failure is the one that pushes the count up to the
    // threshold - send the alert here, once per lockout episode, rather
    // than on every subsequent blocked attempt (which short-circuits
    // above without ever reaching this branch again).
    if ((failedCount ?? 0) + 1 === LOCKOUT_THRESHOLD) {
      await sendLockoutAlertEmail(email);
    }

    // Supabase's own message already avoids confirming whether the
    // account exists; passed through as-is rather than a custom one that
    // might leak more or less than intended.
    return { ok: false, error: error.message };
  }

  await sendNewSignInEmail(email);

  const safeNext = internalRedirectPath(next);
  const { data: assurance } = await supabase.auth.mfa
    .getAuthenticatorAssuranceLevel();
  if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
    redirect(`/auth/mfa?next=${encodeURIComponent(safeNext)}`);
  }

  redirect(safeNext);
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseSession();
  await supabase.auth.signOut();
  redirect("/login");
}
