import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { SplitSettingsForm } from "../../../components/pay/SplitSettingsForm";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isPaySplitsEnabled } from "../../../lib/pay/gate";
import { loadSplitPrefs } from "../../../lib/pay/splits/offer";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

export default async function SplitSettingsPage() {
  const workspaceId = await getActiveWorkspaceId();
  const t = messages().pay.splits.settings;
  if (!isPaySplitsEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title={t.title} backHref="/" backLabel="Home" />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const prefs = user
    ? await loadSplitPrefs(supabase, user.id)
    : { feeSavingEnabled: false, threshold: "balanced" as const };

  return (
    <div>
      <PageHeader title={t.title} backHref="/" backLabel="Home" />
      <SplitSettingsForm initial={prefs} />
    </div>
  );
}
