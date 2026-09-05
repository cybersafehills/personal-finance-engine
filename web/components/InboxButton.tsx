import Link from "next/link";
import { InboxIcon } from "./icons";

/**
 * Header entry point to /inbox. Also carries the unread-notifications
 * badge - Inbox and Notifications used to be two separate header icons
 * (InboxButton + NotificationBell); they're merged into this one button
 * so there's a single "things that need your attention" entry point.
 * /inbox itself now renders a "Notifications" section (see
 * app/inbox/page.tsx) alongside its existing financial-inbox workflow
 * items, so the badge here always points somewhere that shows what it's
 * counting. The count is fetched once in the root layout and refreshed
 * when a mark-read action revalidates the layout (see
 * app/notifications/actions.ts's revalidateNotificationRoutes).
 */
export function InboxButton({ unreadCount = 0 }: { unreadCount?: number }) {
  const label = unreadCount > 0
    ? `Financial Inbox, ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
    : "Financial Inbox";

  return (
    <Link
      href="/inbox"
      prefetch={false}
      aria-label={label}
      title="Inbox"
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:bg-background"
    >
      <InboxIcon className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute right-1.5 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
