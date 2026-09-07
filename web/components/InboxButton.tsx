import Link from "next/link";
import { InboxIcon } from "./icons";

/**
 * Header entry point to /inbox. Carries the inbox count badge - unread
 * notifications plus the open "Needs attention" summary rows, which now
 * live inside /inbox rather than on Home. `count` arrives already 0 when
 * the caller has the badge preference off (ui_preferences.show_inbox_badge,
 * togglable in /inbox and /settings/notifications). The count refreshes
 * whenever the root layout re-runs - a mark-read action or any
 * LiveDataSync-triggered router.refresh().
 */
export function InboxButton({ count = 0 }: { count?: number }) {
  const label = count > 0
    ? `Inbox, ${count} item${count === 1 ? "" : "s"} need your attention`
    : "Inbox";

  return (
    <Link
      href="/inbox"
      prefetch={false}
      aria-label={label}
      title="Inbox"
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:bg-background"
    >
      <InboxIcon className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute right-1.5 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-notification-badge px-1 text-[10px] font-semibold leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
