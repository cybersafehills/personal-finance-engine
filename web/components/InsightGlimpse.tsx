"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const AUTO_HIDE_MS = 30_000;

/**
 * A one-line insight summary that slides in at the top of any page and
 * removes itself after 30s (or on tap). `headline` is resolved
 * server-side (app/layout.tsx → note_insight_change) and is non-null only
 * on the render that actually produced a new notification - the RPC's own
 * de-dupe + 12h rate limit is what stops it re-appearing on the next
 * navigation, so there is no client-side "already seen" bookkeeping here.
 */
export function InsightGlimpse({ headline }: { headline: string | null }) {
  // Adjust local state when the server hands us a new headline (the
  // shell stays mounted across client navigations). Setting state during
  // render for a prop change is the supported React pattern.
  const [shown, setShown] = useState(headline);
  const [visible, setVisible] = useState(true);
  if (headline !== shown) {
    setShown(headline);
    setVisible(headline != null);
  }

  useEffect(() => {
    if (!headline || !visible) return;
    const t = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [headline, visible]);

  if (!headline || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-30 flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]"
    >
      <div className="flex w-full max-w-3xl items-start gap-3 rounded-card border border-border-subtle bg-surface px-4 py-3 text-sm shadow-lg">
        <span className="flex-1 text-text-primary">{headline}</span>
        <Link
          href="/inbox"
          prefetch={false}
          onClick={() => setVisible(false)}
          className="shrink-0 font-medium text-accent hover:underline"
        >
          View →
        </Link>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setVisible(false)}
          className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-text-muted hover:text-text-primary"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
