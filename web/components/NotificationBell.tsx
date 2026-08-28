import Link from "next/link";
import { BellIcon } from "./icons";

/**
 * Header entry point to /notifications with an unread-count badge. The
 * count is fetched once in the root layout (Phase V PR1b) and refreshed
 * when a mark-read action revalidates the layout.
 */
export function NotificationBell({ count }: { count: number }) {
  const label = count > 0
    ? `Notifications, ${count} unread`
    : "Notifications";
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title="Notifications"
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:bg-background"
    >
      <BellIcon className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute right-1.5 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
