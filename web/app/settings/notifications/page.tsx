import { getNotificationSettings, getUiPreferences } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { NotificationPreferencesForm } from "../../../components/NotificationPreferencesForm";
import { InboxBadgeToggle } from "../../../components/InboxBadgeToggle";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const [settings, uiPreferences] = await Promise.all([
    getNotificationSettings(),
    getUiPreferences(),
  ]);

  const badgeToggle = (
    <section className="mb-6" aria-label="Inbox badge">
      <h2 className="mb-2 text-sm font-semibold text-text-primary">
        Inbox icon
      </h2>
      <InboxBadgeToggle enabled={uiPreferences.showInboxBadge} />
    </section>
  );

  if (!settings) {
    return (
      <div>
        <PageHeader title="Notifications" backHref="/settings" />
        {badgeToggle}
        <EmptyState
          title="Nothing else to configure here yet"
          description="Per-event notification preferences apply to shared Spaces. Switch to a household or organization to set them."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={`What ${settings.workspaceName} tells you about — for you only`}
        backHref="/settings"
      />
      {badgeToggle}
      <p className="mb-3 text-sm text-text-muted">
        Security-notable changes (a member added or removed, ownership
        transferred, an account&rsquo;s sharing changed) are always sent
        and can&rsquo;t be turned off.
      </p>
      <NotificationPreferencesForm events={settings.events} />
    </div>
  );
}
