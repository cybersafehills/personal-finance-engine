"use client";

import { useState, useTransition } from "react";
import { dismissReportsRelocationNotice } from "../app/settings/appearance/actions";

/**
 * Restrained, one-time discovery aid for existing users who expect
 * Reports in primary navigation (master prompt §4.3). Shown until
 * dismissed (persisted per-user via ui_preferences), never blocks the
 * rest of the app, and is rendered only when the caller determines the
 * user hasn't dismissed it yet - see AppShell, which also only renders it
 * for signed-in users.
 */
export function ReportsRelocationNotice() {
  const [dismissed, setDismissed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface px-4 py-3 text-sm sm:mx-6"
    >
      <p className="text-text-secondary">
        Reports has moved - open it anytime from the report icon in the top
        right, or from Settings.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setDismissed(true);
          startTransition(() => {
            dismissReportsRelocationNotice();
          });
        }}
        className="shrink-0 rounded-control px-3 py-1.5 text-sm font-medium text-accent hover:underline disabled:opacity-50"
      >
        Got it
      </button>
    </div>
  );
}
