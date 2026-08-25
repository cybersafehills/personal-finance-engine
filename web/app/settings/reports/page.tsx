import { getReportPreferences } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { PageHeader } from "../../../components/PageHeader";
import { ReportPreferencesForm } from "../../../components/ReportPreferencesForm";

export const dynamic = "force-dynamic";

export default async function ReportSettingsPage() {
  const [preferences, supabase] = await Promise.all([
    getReportPreferences(),
    supabaseSession(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Daily reports"
        subtitle="Configure when your daily financial report is generated and emailed"
      />

      <ReportPreferencesForm preferences={preferences} suggestedEmail={user?.email ?? null} />
    </div>
  );
}
