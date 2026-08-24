import { getAccounts } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { AccountItem } from "../../../components/AccountItem";
import { CreateAccountForm } from "../../../components/CreateAccountForm";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await getAccounts();

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="The financial accounts your transactions belong to"
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
