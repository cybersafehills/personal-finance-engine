"use client";

import { useEffect, useState } from "react";
import {
  androidCompanionPairUrl,
  devicePairShortcutRunUrl,
  type PairPlatform,
} from "../lib/pairing";

/**
 * The body of the public `/pair` page. It calls no API — the OneLedger Capture
 * Shortcut (iOS) or the OneLedger Companion app (Android) is what redeems the
 * code. On mount it makes one best-effort attempt to open that app directly;
 * otherwise the user taps the button. The platform comes from `?p=` on the
 * handoff URL the desktop wizard put in the QR.
 */
export function PairHandoff({
  token,
  platform = "ios",
  shortcutUrl,
  companionUrl = null,
}: {
  token: string;
  platform?: PairPlatform;
  /** A signed .shortcut / iCloud link, when one is published (iOS). */
  shortcutUrl: string | null;
  /** A Play listing / signed APK link, when one is published (Android). */
  companionUrl?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const isAndroid = platform === "android";
  const runUrl = isAndroid
    ? androidCompanionPairUrl(token)
    : devicePairShortcutRunUrl(token);

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
              if (!navigator.clipboard) throw new Error("no clipboard");
              await navigator.clipboard.writeText(token);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard unavailable — the code is on screen */
              setCopied(false);
            }
          }}
          aria-live="polite"
          className="min-h-9 w-fit rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground"
        >
          {copied ? "Copied ✓" : "Copy code"}
        </button>
      </div>

      <a
        href={runUrl}
        className="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        {isAndroid
          ? "Open in OneLedger Companion"
          : "Run “Connect to OneLedger”"}
      </a>

      <div className="flex flex-col gap-2 text-sm text-text-secondary">
        <p className="font-medium text-text-primary">
          {isAndroid
            ? "Don't have the Companion app yet?"
            : "Don't have the Shortcut yet?"}
        </p>
        {isAndroid
          ? (
            companionUrl
              ? (
                <a
                  href={companionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  Get the OneLedger Companion app
                </a>
              )
              : (
                <ol className="flex flex-col gap-1">
                  <li>1. Install the OneLedger Companion on this phone.</li>
                  <li>
                    2. Open it, then come back and tap &ldquo;Open in OneLedger
                    Companion&rdquo; above — or just type the code into the app.
                  </li>
                </ol>
              )
          )
          : (
            shortcutUrl
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
                    2. Add the OneLedger Capture Shortcuts, then come back and
                    tap &ldquo;Run &lsquo;Connect to OneLedger&rsquo;&rdquo;
                    above.
                  </li>
                </ol>
              )
          )}
      </div>

      <p className="text-xs text-text-muted">
        Keep this page open — the device you started on updates on its own once
        this phone connects.
      </p>
    </div>
  );
}
