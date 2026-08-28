import { getNotifications } from "../../lib/queries";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { NotificationList } from "../../components/NotificationList";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const notifications = await getNotifications();

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="What's happened in the Spaces you're a member of"
      />

      {notifications.length === 0
        ? (
          <EmptyState
            title="Nothing yet"
            description="Member changes, budget alerts, and shared-goal activity will show up here."
          />
        )
        : <NotificationList notifications={notifications} />}
    </div>
  );
}
