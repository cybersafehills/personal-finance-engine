import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { ProfileSettingsForm } from "../../../components/ProfileSettingsForm";
import { getProfileOnboarding } from "../../../lib/queries";

export const dynamic = "force-dynamic";

// Profile & Preferences (master prompt section 23): edit the name and
// regional defaults after onboarding. Same fields, same server actions as
// /onboarding/profile + /onboarding/preferences - onboarding introduces
// them, Settings manages them.
export default async function ProfileSettingsPage() {
  const profile = await getProfileOnboarding();
  if (!profile) redirect("/login");

  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Profile & region"
        subtitle="Your name and the regional defaults OneLedger uses for currency, dates, and services."
      />
      <ProfileSettingsForm
        initial={{
          firstName: profile.firstName,
          lastName: profile.lastName,
          countryCode: profile.countryCode,
          preferredCurrency: profile.preferredCurrency,
          timezone: profile.timezone,
          locale: profile.locale,
        }}
      />
    </div>
  );
}
