import { supabase } from "@/api/supabase";
import { getRequestedWorkspace } from "@/features/spaces/request-space";

import { listPayerAccounts, type PayerAccount } from "./accounts";
import { payableAccounts, type PayKind } from "./new-form";

/**
 * The accounts the user can pay from in the Space the server will create the
 * draft in (the one named by X-Workspace-Id, else their personal Space). Throws
 * when that can't be worked out, so the screen shows "try again" instead of an
 * empty list that looks like "you have no accounts".
 */
export async function loadPayableAccounts(kind: PayKind): Promise<PayerAccount[]> {
  if (!supabase) throw new Error("not connected");
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("not signed in");

  const requested = getRequestedWorkspace();
  let workspaceId = requested;
  let personal = false;
  if (!requested) {
    const { data, error } = await supabase.from("workspaces").select("id").eq("kind", "personal").maybeSingle();
    if (error || !data) throw new Error("space unavailable");
    workspaceId = data.id as string;
    personal = true;
  } else {
    const { data } = await supabase.from("workspaces").select("kind").eq("id", requested).maybeSingle();
    personal = (data as { kind: string } | null)?.kind === "personal";
  }
  return payableAccounts(await listPayerAccounts(), { workspaceId: workspaceId!, personal, userId }, kind);
}
