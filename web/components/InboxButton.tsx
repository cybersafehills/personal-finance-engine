import Link from "next/link";
import { InboxIcon } from "./icons";

export function InboxButton() {
  return (
    <Link
      href="/inbox"
      aria-label="Financial Inbox"
      title="Financial Inbox"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:bg-background"
    >
      <InboxIcon className="h-5 w-5" />
    </Link>
  );
}
