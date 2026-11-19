"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "../../lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?error=1");

  const supabase = await supabaseSession();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One generic message for every failure: no account enumeration.
  if (error) redirect("/login?error=1");
  redirect("/dashboard");
}
