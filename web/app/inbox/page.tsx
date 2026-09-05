import Link from "next/link";
import { PageHeader } from "../../components/PageHeader";
import { NotificationList } from "../../components/NotificationList";
import { InboxList } from "../../components/InboxList";
import { getFinancialInbox } from "../../lib/financial-inbox";
import { getAuthUserId, getNotifications } from "../../lib/queries";

export const dynamic = "force-dynamic";

// The Financial Inbox is the single front door for "what needs my
// attention?" (assessment sections 33-35): a read/projection model
// (lib/financial-inbox.ts) over every actionable money workflow -
// duplicates, attribution, category review, reconciliation, connector
// health, rule suggestions, imports, sync conflicts, budget alerts,
// bill review - with lightweight inline actions that dispatch each
// domain's authoritative server action (components/InboxList.tsx). Every
// specialized page is a drill-in from here, not a sibling in navigation.
//
// It also shows the most recent notifications (the header Inbox icon's
// unread badge points here); /notifications holds the full history.
const RECENT_NOTIFICATIONS_LIMIT = 8;

export default async function FinancialInboxPage() {
  const [inbox, notifications, currentUserId] = await Promise.all([
    getFinancialInbox(),
    getNotifications(RECENT_NOTIFICATIONS_LIMIT),
    getAuthUserId(),
  ]);

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="One prioritized place for every decision and problem across your ledger"
        backHref="/"
        backLabel="Home"
      />

      {notifications.length > 0 && (
        <section className="mb-6" aria-labelledby="inbox-notifications">
          <div className="mb-2 flex items-center justify-between">
            <h2
              id="inbox-notifications"
              className="text-sm font-semibold text-text-primary"
            >
              Notifications
            </h2>
            <Link
              href="/notifications"
              className="text-sm font-medium text-accent hover:underline"
            >
              View all
            </Link>
          </div>
          <NotificationList notifications={notifications} />
        </section>
      )}

      {inbox.total > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-2" aria-label="Inbox summary">
          <div className="rounded-card border border-border-subtle bg-surface p-3">
            <p className="text-xl font-semibold text-text-primary">
              {inbox.total}
            </p>
            <p className="text-xs text-text-muted">Open</p>
          </div>
          <div className="rounded-card border border-border-subtle bg-surface p-3">
            <p className="text-xl font-semibold text-attention">
              {inbox.criticalCount}
            </p>
            <p className="text-xs text-text-muted">Resolve first</p>
          </div>
          <div className="rounded-card border border-border-subtle bg-surface p-3">
            <p className="text-xl font-semibold text-text-primary">
              {inbox.highCount}
            </p>
            <p className="text-xs text-text-muted">Next up</p>
          </div>
        </div>
      )}

      <InboxList items={inbox.items} currentUserId={currentUserId} />
    </div>
  );
}
