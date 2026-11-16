// The header Inbox badge. Mirrors the web's `getInboxBadgeCount`
// (web/lib/queries.ts): unread notifications plus the open "needs attention"
// rows. The app can only see the review-queue row for now (the others come
// from server read models), so it is a lower bound of the web's number until
// the Inbox endpoint reports an attention count.

/** One attention row when anything is waiting in the review queue. */
export function inboxBadgeCount(unreadNotifications: number, reviewQueueCount: number): number {
  const unread = Number.isFinite(unreadNotifications) ? Math.max(0, unreadNotifications) : 0;
  return unread + (reviewQueueCount > 0 ? 1 : 0);
}

/** "99+" above 99, nothing at 0. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/** Same sentence the web gives its Inbox link. */
export function inboxAccessibilityLabel(count: number): string {
  if (count <= 0) return "Inbox";
  return `Inbox, ${count} item${count === 1 ? "" : "s"} need your attention`;
}
