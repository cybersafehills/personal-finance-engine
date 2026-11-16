import { fetchPayConfig } from "@/api/mobile-api";
import { supabase } from "@/api/supabase";
import { getRequestedWorkspace } from "@/features/spaces/request-space";
import { isInRequestedSpace } from "@/features/spaces/spaces";
import { listPayerAccounts } from "./accounts";
import { accountNetwork, payAgainTarget, type PayAgainTarget } from "./target";

// Decides whether a transaction gets a "Pay X again" button, and with which
// paying account. Every doubt hides the button (a button that cannot work is
// worse than none): config off or unreachable, a transaction that isn't in the
// Space the server will create the draft in, a household role that can't create
// drafts, a reference the server would refuse, or no usable RWF account of the
// user's own.

export type PayAgainOffer = {
  target: PayAgainTarget;
  account: { id: string; name: string } | null;
};

type TxnLike = Parameters<typeof payAgainTarget>[0] & { id: string };

/**
 * The server creates the draft in the ACTIVE Space (the one named by
 * `X-Workspace-Id`, else the user's personal Space) and checks the paying
 * account against it. So only a transaction that lives in that Space can honestly
 * offer this: a personal transaction viewed while a household is active would
 * otherwise put its draft in the household, and a household one is fine while that
 * household is active.
 */
async function transactionPaymentContext(
  id: string,
): Promise<{ accountId: string | null; workspaceId: string; workspaceKind: string | undefined } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("transactions")
    .select("account_id, workspace_id, workspaces(kind)")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    account_id: string | null;
    workspace_id: string;
    workspaces: { kind: string } | { kind: string }[] | null;
  };
  const kind = Array.isArray(row.workspaces) ? row.workspaces[0]?.kind : row.workspaces?.kind;
  return { accountId: row.account_id, workspaceId: row.workspace_id, workspaceKind: kind };
}

/** Roles the database lets create a payment draft (`is_workspace_member(ws, 'member')`); a viewer can't. */
const DRAFT_ROLES: readonly string[] = ["owner", "admin", "member"];

async function myMembership(workspaceId: string): Promise<{ userId: string; role: string | null } | null> {
  if (!supabase) return null;
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return null;
  const { data } = await supabase
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return { userId, role: (data as { role: string } | null)?.role ?? null };
}

export async function loadPayAgainOffer(txn: TxnLike): Promise<PayAgainOffer | null> {
  const target = payAgainTarget(txn);
  if (!target) return null;
  try {
    const config = await fetchPayConfig();
    if (!config.ok || !config.pay || !config.assistedPay) return null;

    const context = await transactionPaymentContext(txn.id);
    // An unreadable Space kind is "not personal": any doubt hides the button.
    if (!context || !isInRequestedSpace({ workspaceId: context.workspaceId, workspaceKind: context.workspaceKind ?? "unknown" }, getRequestedWorkspace())) {
      return null;
    }

    // A viewer in a household can see this but can't create a draft: the database
    // would refuse it after they typed an amount. (Unreadable role: hide.)
    const me = await myMembership(context.workspaceId);
    if (!me || me.role === null || !DRAFT_ROLES.includes(me.role)) return null;
    const personal = context.workspaceKind === "personal";

    // Pay from the account this transaction was made from when it can do the
    // job, else the first account in the same Space that can (the web form
    // preselects the first as well). A merchant payment can only be dialled on
    // MTN (the only merchant-pay code in the directory) and its network comes
    // from this account, so a bank, cash or Airtel account is a dead end: skip
    // it rather than let someone prepare a draft that has no route. A person's
    // network comes from the recipient's number, so there the account is just
    // "pay from" and any mobile-money account will do.
    // In a household the transaction's own account may be ANOTHER member's (the
    // web labels it "Amy's account"): never offer to pay from it, and for a
    // merchant it would also decide the network. Only the user's own accounts
    // count there; an account whose owner can't be told is skipped. (In a personal
    // Space every account is the user's.)
    const usable = (await listPayerAccounts()).filter(
      (a) =>
        a.workspaceId === context.workspaceId &&
        (personal || a.ownerUserId === me.userId) &&
        a.currency === "RWF" &&
        (target.type === "pay_merchant" ? accountNetwork(a.provider) === "mtn" : accountNetwork(a.provider) !== null),
    );
    const account = usable.find((a) => a.id === context.accountId) ?? usable[0] ?? null;

    if (target.type === "pay_merchant" && !account) return null;
    return { target, account: account ? { id: account.id, name: account.name } : null };
  } catch {
    return null;
  }
}
