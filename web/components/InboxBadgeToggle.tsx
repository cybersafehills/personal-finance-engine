"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setInboxBadgePreference } from "../app/inbox/actions";

/**
 * Small console for the header inbox icon's count badge. The count is
 * always visible inside the Inbox itself; this only controls whether it
 * also appears as a badge on the icon. Rendered in /inbox and in
 * /settings/notifications.
 */
export function InboxBadgeToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic so the checkbox responds immediately.
  const [checked, setChecked] = useState(enabled);

  function onChange(next: boolean) {
    setError(null);
    setChecked(next);
    startTransition(async () => {
      const result = await setInboxBadgePreference(next);
      if (!result.ok) {
        setChecked(!next);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-card border border-border-subtle bg-surface p-4">
      <label className="flex items-start justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-text-primary">
            Show a count on the inbox icon
          </span>
          <span className="text-xs text-text-muted">
            A small badge on the header inbox icon showing how many things
            need you. Turn it off and the count still shows inside the inbox.
          </span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={isPending}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 disabled:opacity-50"
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-attention">{error}</p>
      )}
    </div>
  );
}
