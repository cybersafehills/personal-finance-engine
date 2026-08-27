import { getUiPreferences } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { NavOrderForm } from "../../../components/NavOrderForm";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const preferences = await getUiPreferences();

  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Appearance and navigation"
        subtitle="Arrange your primary navigation the way you use it"
      />

      <NavOrderForm initialOrder={preferences.navOrder} />
    </div>
  );
}
