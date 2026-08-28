"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setNotificationPreference } from "../app/settings/notifications/actions";
import { Badge } from "./Badge";
import type { NotificationEventSetting } from "../lib/queries";

export function NotificationPreferencesForm({
  events,
}: {
  events: NotificationEventSetting[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggle(eventKey: string, channel: "in_app" | "email", next: boolean) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setNotificationPreference(eventKey, channel, next);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 pb-1 text-xs font-medium text-text-muted">
        <span>Event</span>
        <span className="w-14 text-center">In-app</span>
        <span className="w-14 text-center">Email</span>
      </div>

      {events.map((event) => (
        <div
          key={event.eventKey}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 rounded-card border border-border-subtle bg-surface px-4 py-3"
        >
          <span className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
            {event.label}
            {event.securityNotable && <Badge variant="neutral">Always on</Badge>}
          </span>

          {(["in_app", "email"] as const).map((channel) => {
            const checked = channel === "in_app" ? event.inApp : event.email;
            return (
              <span key={channel} className="flex w-14 justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={checked}
                  disabled={event.securityNotable || isPending}
                  aria-label={`${event.label} — ${
                    channel === "in_app" ? "in-app" : "email"
                  }`}
                  onChange={(e) =>
                    toggle(event.eventKey, channel, e.target.checked)
                  }
                />
              </span>
            );
          })}
        </div>
      ))}

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
