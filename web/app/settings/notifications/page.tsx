import { getNotificationSettings } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { NotificationPreferencesForm } from "../../../components/NotificationPreferencesForm";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const settings = await getNotificationSettings();

  if (!settings) {
    return (
      <div>
        <PageHeader title="Notifications" backHref="/settings" />
        <EmptyState
          title="Nothing to configure here yet"
          description="Notification preferences apply to shared Spaces. Switch to a household or organization to set them."
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
      <p className="mb-3 text-sm text-text-muted">
        Security-notable changes (a member added or removed, ownership
        transferred, an account&rsquo;s sharing changed) are always sent
        and can&rsquo;t be turned off.
      </p>
      <NotificationPreferencesForm events={settings.events} />
    </div>
  );
}
