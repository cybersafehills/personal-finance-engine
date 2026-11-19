"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "../lib/supabase/server";

export async function signOut() {
  const supabase = await supabaseSession();
  await supabase.auth.signOut();
  redirect("/login");
}
