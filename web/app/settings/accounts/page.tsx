import Link from "next/link";
import { getAccounts, getActiveWorkspaceId } from "../../../lib/queries";
import { isOneLedger3FlagEnabled } from "../../../lib/oneledger3-flags";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { AccountItem } from "../../../components/AccountItem";
import { CreateAccountForm } from "../../../components/CreateAccountForm";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await getAccounts();
  // Only look up the workspace while the feature could be on.
  const walletsEnabled = process.env.BALANCE_PROVENANCE_ENABLED === "true" &&
    isOneLedger3FlagEnabled(
      process.env,
      "BALANCE_PROVENANCE",
      await getActiveWorkspaceId(),
    );

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="The financial accounts your transactions belong to"
        action={walletsEnabled
          ? (
            <Link
              href="/wallets"
              className="text-sm font-medium text-accent hover:underline"
            >
              Balances
            </Link>
          )
          : undefined}
      />

      <div className="flex flex-col gap-3">
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Add an account to start connecting a device to it."
          />
        ) : (
          accounts.map((account) => (
            <AccountItem key={account.id} account={account} />
          ))
        )}

        <CreateAccountForm />
      </div>
    </div>
  );
}
