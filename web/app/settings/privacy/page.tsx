import Link from "next/link";
import { getUiPreferences } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { PrivacyPreferencesForm } from "../../../components/PrivacyPreferencesForm";

export const dynamic = "force-dynamic";

export default async function PrivacySettingsPage() {
  const preferences = await getUiPreferences();

  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Privacy"
        subtitle="What's visible on screen, independent of sign-in and permissions. Sign-in protection lives in Security."
      />

      <PrivacyPreferencesForm
        initialHideBalance={preferences.hideBalance}
        initialPrivacyMode={preferences.privacyMode}
      />

      <Link
        href="/settings/privacy/data"
        className="mt-4 flex flex-col gap-0.5 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
      >
        <span className="text-sm font-medium text-text-primary">
          Your data & account
        </span>
        <span className="text-sm text-text-muted">
          Export everything OneLedger holds for you, or close your account.
        </span>
      </Link>
    </div>
  );
}
