"use client";

import { useEffect } from "react";

/**
 * Root-layout error boundary (master prompt §16.2: "client rendering
 * errors in the application shell"). app/error.tsx only catches errors
 * in page segments - it does NOT cover app/layout.tsx itself, which is
 * where AppShell (header, both navs, profile menu, PrivacyProvider)
 * actually renders. Without this file, a bug in the shell has no
 * boundary at all: a blank page, not a recoverable one. Next.js requires
 * this file to render its own complete <html>/<body> - it replaces the
 * entire root layout when triggered, so it cannot depend on that layout
 * still working.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged server/browser-side only, never rendered to the user - no
    // internal error detail, stack trace, or infrastructure information
    // is ever exposed in the UI. Never logs any financial data: this
    // boundary only ever sees a JS Error object, never a preference,
    // balance, or transaction value.
    console.error("Unhandled application-shell error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <div
          role="alert"
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            padding: "1.5rem",
            textAlign: "center",
            backgroundColor: "#f6f6f7",
            color: "#18181b",
          }}
        >
          <p style={{ fontSize: "1rem", fontWeight: 500, margin: 0 }}>
            Something went wrong.
          </p>
          <p style={{ fontSize: "0.875rem", color: "#6b6b73", margin: 0 }}>
            Your data is safe. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "0.5rem",
              minHeight: "44px",
              borderRadius: "0.625rem",
              border: "none",
              backgroundColor: "#33509e",
              color: "#ffffff",
              padding: "0 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
