"use server";

import { supabaseSession } from "../../lib/supabase-session-server";
import { siteUrl } from "../../lib/site-url";

export type SignUpResult =
  | { ok: true; needsConfirmation: boolean }
  | { ok: false; error: string };

export async function signUp(
  email: string,
  password: string,
  next: string,
): Promise<SignUpResult> {
  const supabase = await supabaseSession();

  const callbackUrl = new URL("/auth/callback", siteUrl());
  if (next) callbackUrl.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // handle_new_user() (20260821000000_phase_b_identity_and_tenancy.sql)
  // provisions the profile/workspace/membership immediately on the
  // auth.users insert, regardless of confirmation state - "normal
  // financial use" is what email verification gates, not the
  // workspace's existence. If Supabase Auth already has a confirmed
  // session (email confirmations disabled in this environment),
  // data.session is set and the user is already signed in.
  return { ok: true, needsConfirmation: !data.session };
}
