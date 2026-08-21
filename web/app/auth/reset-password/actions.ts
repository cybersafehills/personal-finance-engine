"use server";

import { supabaseSession } from "../../../lib/supabase-session-server";

export type ResetResult = { ok: true } | { ok: false; error: string };

export async function requestPasswordReset(
  email: string,
  siteUrl: string,
): Promise<ResetResult> {
  const supabase = await supabaseSession();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/auth/reset-password/confirm`,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function updatePassword(password: string): Promise<ResetResult> {
  const supabase = await supabaseSession();

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
