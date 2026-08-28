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
        {notifications.map((n) => {
          const href = hrefFor(n);
          const unread = n.readAt === null;
          return (
            <li
              key={n.id}
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
                  onClick={() => run(() => markNotificationRead(n.id))}
                  className="min-h-8 shrink-0 text-xs font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
                >
                  Mark read
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
