"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { assembleAccountDataExport } from "../../../../lib/account-data";
import { isAccountDeletionEnabled } from "../../../../lib/account-deletion";

export type DataActionResult = { ok: true } | { ok: false; error: string };

export async function exportMyData(): Promise<
  { ok: true; filename: string; json: string } | { ok: false; error: string }
> {
  const bundle = await assembleAccountDataExport();
  if (!bundle) return { ok: false, error: "Not signed in." };
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    filename: `oneledger-data-export-${stamp}.json`,
    json: JSON.stringify(bundle, null, 2),
  };
}

export async function requestAccountDeletion(
  reason: string,
): Promise<DataActionResult> {
  if (!isAccountDeletionEnabled()) {
    return { ok: false, error: "Account deletion isn't available yet." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("request_account_deletion", {
    p_reason: reason.trim() || null,
  });
  if (error) {
    // Surface the RPC's own guard message (sole owner of a shared Space);
    // fall back to a generic line for anything else.
    const msg = /shared Spaces/i.test(error.message)
      ? error.message
      : "Could not schedule deletion. Try again.";
    console.error("requestAccountDeletion failed:", error.message);
    return { ok: false, error: msg };
  }
  revalidatePath("/settings/privacy/data");
  return { ok: true };
}

export async function cancelAccountDeletion(): Promise<DataActionResult> {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) {
    console.error("cancelAccountDeletion failed:", error.message);
    return { ok: false, error: "Could not cancel. Try again." };
  }
  revalidatePath("/settings/privacy/data");
  return { ok: true };
}
