"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "../../lib/supabase-session-server";
import { passwordSignIn } from "../../lib/auth/password-sign-in";
import { internalRedirectPath } from "../../lib/internal-redirect";

export type AuthActionResult = { ok: true } | { ok: false; error: string };

export async function signIn(
  email: string,
  password: string,
  next: string,
): Promise<AuthActionResult> {
  const supabase = await supabaseSession();
  // Lockout, attempt log and security emails live in the shared helper so
  // the mobile API (app/api/mobile/auth/sign-in) behaves identically.
  const result = await passwordSignIn(supabase, email, password);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const safeNext = internalRedirectPath(next);
  if (result.mfaRequired) {
    redirect(`/auth/mfa?next=${encodeURIComponent(safeNext)}`);
  }

  redirect(safeNext);
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseSession();
  await supabase.auth.signOut();
  redirect("/login");
}
