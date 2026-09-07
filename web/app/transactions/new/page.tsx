import { getAccounts, getCategorySuggestions } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { ManualTransactionForm } from "../../../components/ManualTransactionForm";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage() {
  const [accounts, categorySuggestions] = await Promise.all([
    getAccounts(),
    getCategorySuggestions(),
  ]);
  const activeAccounts = accounts.filter((a) => a.is_active);

  return (
    <div>
      <PageHeader title="Add transaction" subtitle="Manually record a transaction" />
      <ManualTransactionForm
        accounts={activeAccounts}
        categorySuggestions={categorySuggestions}
      />
    </div>
  );
}
