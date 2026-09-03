"use client";

import { useEffect, useState } from "react";
import { deviceCaptureShortcutRunUrl } from "../lib/pairing";

/**
 * The body of the public `/pair` page. It calls no API — the OneLedger Capture
 * Shortcut is what redeems the code. On mount it makes one best-effort attempt
 * to open the Shortcut directly; otherwise the user taps the button.
 */
export function PairHandoff({
  token,
  shortcutUrl,
}: {
  token: string;
  /** A signed .shortcut / iCloud link, when one is published. */
  shortcutUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const runUrl = deviceCaptureShortcutRunUrl(token);

  useEffect(() => {
    // One shot — don't fight the user if they come back to this tab.
    const t = setTimeout(() => {
      globalThis.location.href = runUrl;
    }, 400);
    return () => clearTimeout(t);
  }, [runUrl]);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-card border border-border-strong bg-surface p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Pairing code · expires in ~10 min
        </span>
        <code className="block break-all text-lg font-semibold text-text-primary">
          {token}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard?.writeText(token);
              setCopied(true);
            } catch {
              /* clipboard unavailable — the code is on screen */
            }
          }}
          className="min-h-9 w-fit rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground"
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>

      <a
        href={runUrl}
        className="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        Run OneLedger Capture
      </a>

      <div className="flex flex-col gap-2 text-sm text-text-secondary">
        <p className="font-medium text-text-primary">
          Don&apos;t have the Shortcut yet?
        </p>
        {shortcutUrl
          ? (
            <a
              href={shortcutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent hover:underline"
            >
              Add OneLedger Capture
            </a>
          )
          : (
            <ol className="flex flex-col gap-1">
              <li>1. Open the Shortcuts app.</li>
              <li>
                2. Add the OneLedger Capture Shortcut, then come back and tap
                &ldquo;Run OneLedger Capture&rdquo; above.
              </li>
            </ol>
          )}
      </div>

      <p className="text-xs text-text-muted">
        Keep this page open — the device you started on updates on its own once
        this phone connects.
      </p>
    </div>
  );
}
