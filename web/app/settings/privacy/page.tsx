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
    </div>
  );
}
