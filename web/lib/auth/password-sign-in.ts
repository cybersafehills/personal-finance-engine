import "server-only";

import type { Session, SupabaseClient } from "@supabase/supabase-js";

import { sendLockoutAlertEmail, sendNewSignInEmail } from "../emails";
import { supabaseServer } from "../supabase-server";

// The one password sign-in path, shared by the web login server action
// (app/login/actions.ts, cookie session) and the mobile API
// (app/api/mobile/auth/sign-in, token response). Keeping it in one place
// means the per-account lockout, the attempt log and the security emails
// can never differ between the two clients.
//
// Defense-in-depth beyond Supabase's own per-IP rate limit
// (auth.rate_limit.sign_in_sign_ups in supabase/config.toml), which does
// nothing against a targeted attempt against one account spread across
// many IPs. See supabase/migrations/20260826000000_auth_login_lockout.sql.
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_WINDOW = "15 minutes";

export type PasswordSignInResult =
  | {
    ok: true;
    session: Session | null;
    /** A verified second factor exists and this session is not yet aal2. */
    mfaRequired: boolean;
  }
  | { ok: false; error: string; lockedOut: boolean };

/**
 * `client` decides where the resulting session lives: the cookie-bound
 * server client for the web, a non-persisting anon client for mobile.
 */
export async function passwordSignIn(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<PasswordSignInResult> {
  const privileged = supabaseServer();

  const { data: failedCount, error: lockoutCheckError } = await privileged.rpc(
    "recent_failed_login_count",
    { p_email: email, p_window: LOCKOUT_WINDOW },
  );

  if (!lockoutCheckError && (failedCount ?? 0) >= LOCKOUT_THRESHOLD) {
    return {
      ok: false,
      error: "Too many attempts. Try again in a few minutes.",
      lockedOut: true,
    };
  }

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

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
    return { ok: false, error: error.message, lockedOut: false };
  }

  await sendNewSignInEmail(email);

  const { data: assurance } = await client.auth.mfa
    .getAuthenticatorAssuranceLevel();
  const mfaRequired = assurance?.nextLevel === "aal2" &&
    assurance.currentLevel !== "aal2";

  return { ok: true, session: data.session, mfaRequired };
}
