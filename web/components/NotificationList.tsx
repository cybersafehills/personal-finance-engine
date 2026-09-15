"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "../app/notifications/actions";
import { formatDateTime } from "../lib/format";
import type { NotificationRow } from "../lib/queries";

function hrefFor(n: NotificationRow): string | null {
  switch (n.resourceType) {
    case "workspace":
      return "/settings/workspace";
    case "budget":
      return "/budgets";
    case "goal":
      return n.resourceId ? `/budgets/goals/${n.resourceId}` : "/budgets/goals";
    case "transaction":
      return n.resourceId ? `/transactions/${n.resourceId}` : "/transactions";
    default:
      return null;
  }
}

// A recurring alert (e.g. the daily cash-flow "heads up") legitimately
// re-fires every day with slightly different numbers in the body, which
// reads as noise when several land back-to-back - same title, same shape,
// different digits. Group same-title notifications together: show the
// most recent in full, the rest folded behind a "Show N earlier" toggle
// rather than hidden outright (still individually mark-readable, still in
// the same recency order otherwise).
function groupByTitle(
  list: NotificationRow[],
): { first: NotificationRow; rest: NotificationRow[] }[] {
  const order: string[] = [];
  const byTitle = new Map<string, NotificationRow[]>();
  for (const n of list) {
    if (!byTitle.has(n.title)) {
      byTitle.set(n.title, []);
      order.push(n.title);
    }
    byTitle.get(n.title)!.push(n);
  }
  return order.map((title) => {
    const [first, ...rest] = byTitle.get(title)!;
    return { first, rest };
  });
}

function NotificationRow({
  n,
  isPending,
  onMarkRead,
}: {
  n: NotificationRow;
  isPending: boolean;
  onMarkRead: () => void;
}) {
  const href = hrefFor(n);
  const unread = n.readAt === null;
  return (
    <li
      className={`flex items-start gap-3 rounded-card border p-4 ${
        unread
          ? "border-border-subtle bg-surface"
          : "border-border-subtle bg-background"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          unread ? "bg-accent" : "bg-transparent"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">
          {href
            ? (
              <Link href={href} className="hover:underline">
                {n.title}
              </Link>
            )
            : n.title}
        </p>
        {n.body && (
          <p className="mt-0.5 text-sm text-text-muted">{n.body}</p>
        )}
        <p className="mt-1 text-xs text-text-muted">
          {formatDateTime(n.createdAt)}
        </p>
      </div>
      {unread && (
        <button
          type="button"
          disabled={isPending}
          onClick={onMarkRead}
          className="min-h-8 shrink-0 text-xs font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
        >
          Mark read
        </button>
      )}
    </li>
  );
}

function NotificationGroup({
  first,
  rest,
  isPending,
  onMarkRead,
}: {
  first: NotificationRow;
  rest: NotificationRow[];
  isPending: boolean;
  onMarkRead: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const unreadRest = rest.filter((n) => n.readAt === null).length;

  return (
    <>
      <NotificationRow
        n={first}
        isPending={isPending}
        onMarkRead={() => onMarkRead(first.id)}
      />
      {rest.length > 0 && !expanded && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-5 text-xs font-medium text-text-muted hover:text-text-primary"
          >
            Show {rest.length} earlier{unreadRest > 0 ? ` (${unreadRest} unread)` : ""}
          </button>
        </li>
      )}
      {expanded &&
        rest.map((n) => (
          <NotificationRow
            key={n.id}
            n={n}
            isPending={isPending}
            onMarkRead={() => onMarkRead(n.id)}
          />
        ))}
    </>
  );
}

export function NotificationList({
  notifications,
}: {
  notifications: NotificationRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  const groups = groupByTitle(notifications);

  return (
    <div className="flex flex-col gap-3">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">
            {unreadCount} unread
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(markAllNotificationsRead)}
            className="min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-attention">{error}</p>
      )}

      <ul className="flex flex-col gap-2">
        {groups.map(({ first, rest }) => (
          <NotificationGroup
            key={first.id}
            first={first}
            rest={rest}
            isPending={isPending}
            onMarkRead={(id) => run(() => markNotificationRead(id))}
          />
        ))}
      </ul>
    </div>
  );
}
