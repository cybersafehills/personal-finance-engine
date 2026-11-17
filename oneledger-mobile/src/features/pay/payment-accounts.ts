import { supabase } from "@/api/supabase";
import { getRequestedWorkspace } from "@/features/spaces/request-space";

import { listPayerAccounts, type PayerAccount } from "./accounts";
import { payableAccounts, type PayKind } from "./new-form";

/**
 * The Space the server will act in: the one named by X-Workspace-Id, else the
 * user's personal Space. Throws when it can't be worked out, so a screen shows
 * "try again" instead of an empty result that looks like "nothing here".
 */
export async function activeWorkspace(): Promise<{ workspaceId: string; personal: boolean; userId: string }> {
  if (!supabase) throw new Error("not connected");
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("not signed in");

  const requested = getRequestedWorkspace();
  if (!requested) {
    const { data, error } = await supabase.from("workspaces").select("id").eq("kind", "personal").maybeSingle();
    if (error || !data) throw new Error("space unavailable");
    return { workspaceId: data.id as string, personal: true, userId };
  }
  const { data } = await supabase.from("workspaces").select("kind").eq("id", requested).maybeSingle();
  return { workspaceId: requested, personal: (data as { kind: string } | null)?.kind === "personal", userId };
}

/** The accounts the user can pay from in the active Space. */
export async function loadPayableAccounts(kind: PayKind): Promise<PayerAccount[]> {
  const ctx = await activeWorkspace();
  return payableAccounts(await listPayerAccounts(), ctx, kind);
}
