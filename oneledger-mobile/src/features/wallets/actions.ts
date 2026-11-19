import { supabase } from "@/api/supabase";
import { selectedWorkspaceId } from "@/features/spaces/selected-space";
export async function makeDefaultWallet(accountId: string) {
  if (!supabase) return { ok: false, message: "The app isn't connected yet." };
  const { error } = await supabase.rpc("set_default_wallet", { p_workspace_id: selectedWorkspaceId(), p_account_id: accountId });
  return error ? { ok: false, message: "Couldn't change the default. Check your access and two-step verification, then try again." } : { ok: true };
}
export async function addWallet(input: { name: string; provider: string; currency: string }) {
  if (!supabase) return { ok: false, message: "The app isn't connected yet." };
  const { data, error } = await supabase.rpc("create_supported_wallet", { p_workspace_id: selectedWorkspaceId(), p_name: input.name.trim(), p_provider: input.provider, p_currency: input.currency });
  return error ? { ok: false, message: "Couldn't add this wallet. Only the owner of a Personal or organization Space can add it here. Check your connection and two-step verification." } : { ok: true, id: data as string };
}

type WalletEdit =
  | { action: "rename"; name: string }
  | { action: "archive" | "restore" };

export async function manageWallet(accountId: string, edit: WalletEdit) {
  if (!supabase) return { ok: false as const, message: "The app isn't connected yet." };
  try {
    const { error } = await supabase.rpc("manage_wallet", {
      p_workspace_id: selectedWorkspaceId(),
      p_account_id: accountId,
      p_action: edit.action,
      ...(edit.action === "rename" ? { p_name: edit.name.trim() } : {}),
    });
    if (!error) return { ok: true as const };
    if (error.message === "mfa_required") {
      return { ok: false as const, message: "Verify your two-step sign-in before changing this wallet." };
    }
  } catch {
    // Connection loss and a changed Space use the same retry state.
  }
  return { ok: false as const, message: "Couldn't update this wallet. Check your access and connection, then try again." };
}
