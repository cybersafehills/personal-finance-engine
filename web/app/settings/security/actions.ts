"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";

export type SecurityActionResult = { ok: true } | { ok: false; error: string };

/**
 * Signs out every session for the current user except the one making this
 * request. No Admin API involved - `scope: "others"` is available on the
 * ordinary session-bound client and only ever affects the caller's own
 * sessions.
 */
export async function signOutOtherSessions(): Promise<SecurityActionResult> {
  const supabase = await supabaseSession();

  const { error } = await supabase.auth.signOut({ scope: "others" });

  if (error) {
    return { ok: false, error: "Could not sign out other sessions." };
  }

  revalidatePath("/settings/security");
  return { ok: true };
}
