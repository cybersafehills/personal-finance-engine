"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged server/browser-side only - never rendered to the user, so no
    // internal error detail, stack trace, or infrastructure information is
    // ever exposed in the UI.
    console.error("Unhandled UI error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface px-6 py-12 text-center"
    >
      <p className="text-base font-medium text-text-primary">
        Something went wrong loading this page.
      </p>
      <p className="text-sm text-text-muted">
        Your data is safe. Please try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        Try again
      </button>
    </div>
  );
}
