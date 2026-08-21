"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "../../lib/supabase-session-server";

export type AuthActionResult = { ok: true } | { ok: false; error: string };

export async function signIn(
  email: string,
  password: string,
  next: string,
): Promise<AuthActionResult> {
  const supabase = await supabaseSession();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase's own message already avoids confirming whether the
    // account exists; passed through as-is rather than a custom one that
    // might leak more or less than intended.
    return { ok: false, error: error.message };
  }

  redirect(next || "/");
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseSession();
  await supabase.auth.signOut();
  redirect("/login");
}
