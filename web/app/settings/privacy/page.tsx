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
        title="Privacy and security"
        subtitle="Control what's visible on screen, independent of sign-in and permissions"
      />

      <PrivacyPreferencesForm
        initialHideBalance={preferences.hideBalance}
        initialPrivacyMode={preferences.privacyMode}
      />
    </div>
  );
}
