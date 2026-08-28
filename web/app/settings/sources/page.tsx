import Link from "next/link";
import {
  getMyFinancialSources,
  getShareableHouseholds,
} from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { SourceItem } from "../../../components/SourceItem";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [sources, households] = await Promise.all([
    getMyFinancialSources(),
    getShareableHouseholds(),
  ]);

  return (
    <div>
      <PageHeader
        title="Shared accounts"
        subtitle="Choose what each household can see of your accounts. Nothing is shared until you say so."
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
        {sources.length === 0 ? (
          <EmptyState
            title="No accounts to share yet"
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

        {sources.length > 0 && households.length === 0 && (
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
