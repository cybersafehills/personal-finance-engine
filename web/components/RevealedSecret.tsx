"use client";

import { useState } from "react";

/**
 * Shows a freshly generated/rotated ingestion credential exactly once.
 * The parent only holds this value in local React state (never persisted,
 * never sent anywhere else) - once the component unmounts or the user
 * navigates away, it is genuinely gone, matching what the database itself
 * guarantees (only the hash is stored).
 */
export function RevealedSecret({
  secret,
  onDismiss,
}: {
  secret: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-attention bg-attention-bg p-4">
      <p className="text-sm font-medium text-attention">
        Copy this now — it won&apos;t be shown again
      </p>

      <code className="block break-all rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary">
        {secret}
      </code>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-9 text-xs font-medium text-text-muted hover:text-text-primary"
        >
          Done
        </button>
      </div>

      <div className="border-t border-border-strong pt-3 text-xs text-text-secondary">
        <p className="font-medium text-text-primary">iPhone Shortcut setup</p>
        <p className="mt-1">
          In your MTN MoMo forwarding Shortcut, set the{" "}
          <code className="rounded bg-surface px-1 py-0.5">x-ingest-key</code>{" "}
          header to the value above, then save. Existing forwarded messages
          are unaffected.
        </p>
      </div>
    </div>
  );
}
