import { fetchPayConfig } from "@/api/mobile-api";
import { supabase } from "@/api/supabase";
import { listPayerAccounts } from "./accounts";
import { accountNetwork, payAgainTarget, type PayAgainTarget } from "./target";

// Decides whether a transaction gets a "Pay X again" button, and with which
// paying account. Every doubt hides the button (a button that cannot work is
// worse than none): config off or unreachable, a transaction in a shared Space,
// a reference the server would refuse, or no usable RWF account.

export type PayAgainOffer = {
  target: PayAgainTarget;
  account: { id: string; name: string } | null;
};

type TxnLike = Parameters<typeof payAgainTarget>[0] & { id: string };

/**
 * The server creates intents in the user's personal Space, so only a
 * transaction that lives there can honestly offer this. (When the app gains an
 * active-Space switch, compare against that Space instead.)
 */
async function transactionPaymentContext(
  id: string,
): Promise<{ accountId: string | null; workspaceId: string; personal: boolean } | null> {
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
  return { accountId: row.account_id, workspaceId: row.workspace_id, personal: kind === "personal" };
}

export async function loadPayAgainOffer(txn: TxnLike): Promise<PayAgainOffer | null> {
  const target = payAgainTarget(txn);
  if (!target) return null;
  try {
    const config = await fetchPayConfig();
    if (!config.ok || !config.pay || !config.assistedPay) return null;

    const context = await transactionPaymentContext(txn.id);
    if (!context || !context.personal) return null;

    // Pay from the account this transaction was made from when it can do the
    // job, else the first account in the same Space that can (the web form
    // preselects the first as well). A merchant payment can only be dialled on
    // MTN (the only merchant-pay code in the directory) and its network comes
    // from this account, so a bank, cash or Airtel account is a dead end: skip
    // it rather than let someone prepare a draft that has no route. A person's
    // network comes from the recipient's number, so there the account is just
    // "pay from" and any mobile-money account will do.
    const usable = (await listPayerAccounts()).filter(
      (a) =>
        a.workspaceId === context.workspaceId &&
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
