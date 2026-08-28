import Link from "next/link";
import {
  getActiveWorkspaceId,
  getMyFinancialSources,
  getShareableHouseholds,
} from "../../../lib/queries";
import { isSpacesEnabled } from "../../../lib/spaces/gate";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { SourceItem } from "../../../components/SourceItem";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const spacesEnabled = isSpacesEnabled(await getActiveWorkspaceId());
  const [sources, households] = await Promise.all([
    getMyFinancialSources(),
    spacesEnabled ? getShareableHouseholds() : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        title={spacesEnabled ? "Shared accounts" : "Accounts"}
        subtitle={spacesEnabled
          ? "Choose what each household can see of your accounts. Nothing is shared until you say so."
          : "Your MoMo, bank, and cash accounts. Import a statement to bring transactions in."}
        action={sources.length > 0
          ? (
            <Link
              href="/settings/sources/import"
              className="text-sm font-medium text-accent"
            >
              Import a statement
            </Link>
          )
          : undefined}
      />

      <div className="flex flex-col gap-3">
        {spacesEnabled && sources.length > 0 && (
          <p className="text-sm text-text-muted">
            Sharing is per account and off by default. &ldquo;Transactions
            only&rdquo; lets a household see what you spend from an account
            but not its balance; &ldquo;Balance &amp; transactions&rdquo;
            shows both. You can pause or stop sharing any time.
          </p>
        )}

        {sources.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Your MoMo, bank, and cash accounts show up here once they exist. Add one under Settings → Accounts."
          />
        ) : (
          sources.map((source) => (
            <SourceItem
              key={source.id}
              source={source}
              households={households}
            />
          ))
        )}

        {spacesEnabled && sources.length > 0 && households.length === 0 && (
          <p className="text-sm text-text-muted">
            You&rsquo;re not in a household yet. Create one under{" "}
            <span className="font-medium text-text-secondary">
              Settings → Spaces
            </span>{" "}
            to start sharing an account.
          </p>
        )}
      </div>
    </div>
  );
}
