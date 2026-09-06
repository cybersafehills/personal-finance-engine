import { PageHeader } from "../../../../components/PageHeader";
import { DataExportButton } from "../../../../components/DataExportButton";
import { AccountDeletionControls } from "../../../../components/AccountDeletionControls";
import {
  getAccountDeletionRequest,
  isAccountDeletionEnabled,
} from "../../../../lib/account-deletion";

export const dynamic = "force-dynamic";

// Your data & account (master prompt §94-95, audit F12). Export is always
// available - a user's own data is never gated. Account deletion ships
// behind ACCOUNT_DELETION_ENABLED; when off, only the export section
// shows.
export default async function DataAndAccountPage() {
  const deletionEnabled = isAccountDeletionEnabled();
  const request = deletionEnabled ? await getAccountDeletionRequest() : null;

  return (
    <div>
      <PageHeader
        backHref="/settings/privacy"
        title="Your data & account"
        subtitle="Export everything OneLedger holds for you, or close your account."
      />

      <section className="mb-6 flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">
          Export your data
        </h2>
        <p className="text-sm text-text-muted">
          A JSON file with your profile, financial sources, accounts,
          transactions, rules, budgets, and goals. Free, always.
        </p>
        <DataExportButton />
      </section>

      {deletionEnabled && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-text-primary">
            Delete your account
          </h2>
          <p className="text-sm text-text-muted">
            Permanently removes your account and the data in your Personal
            Space after a 30-day grace period. If you solely own a shared
            Space with other members, transfer it or remove them first.
          </p>
          <AccountDeletionControls request={request} />
        </section>
      )}
    </div>
  );
}
