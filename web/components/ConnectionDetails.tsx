"use client";

import { useState } from "react";
import Link from "next/link";
import {
  INGEST_BODY_EXAMPLE,
  INGEST_REQUEST,
} from "../lib/ingest";

/**
 * Read-only reference for wiring a device (an iPhone Shortcut, or any
 * SMS forwarder) to a connection: the endpoint URL, the request shape,
 * and what the responses mean. Shown on every ConnectionItem - not just
 * once at creation - because a user setting up their Shortcut days later
 * needs these exact values and the one-time secret reveal is long gone.
 *
 * Never renders the credential itself; the full `pfe_…` key is shown only
 * by RevealedSecret at create / rotate time.
 */

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <div className="flex items-start gap-2">
        <code className="flex-1 break-all rounded-control border border-border-subtle bg-background px-2 py-1.5 text-xs text-text-primary">
          {value}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard blocked (insecure context / permissions) - the
              // value is right there to select by hand.
            }
          }}
          className="min-h-8 shrink-0 rounded-control border border-border-subtle px-2 text-[11px] font-medium text-text-secondary hover:text-text-primary"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function ConnectionDetails({
  endpointUrl,
  defaultOpen = false,
}: {
  endpointUrl: string | null;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-control border border-border-subtle bg-surface"
    >
      <summary className="min-h-11 cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-accent [&::-webkit-details-marker]:hidden">
        Connection details for your Shortcut
      </summary>

      <div className="flex flex-col gap-3 border-t border-border-subtle px-3 py-3">
        {endpointUrl
          ? <CopyField label="Endpoint URL" value={endpointUrl} />
          : (
            <p className="text-xs text-attention">
              Endpoint URL isn&apos;t available in this environment (the
              Supabase URL is not configured).
            </p>
          )}

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Request
          </span>
          <ul className="flex flex-col gap-0.5 text-xs text-text-secondary">
            <li>
              Method{" "}
              <code className="rounded bg-background px-1 py-0.5">
                {INGEST_REQUEST.method}
              </code>
            </li>
            <li>
              Header{" "}
              <code className="rounded bg-background px-1 py-0.5">
                {INGEST_REQUEST.authHeader}
              </code>{" "}
              — the key that starts{" "}
              <code className="rounded bg-background px-1 py-0.5">pfe_</code>{" "}
              (shown in full only when you create or rotate this
              connection). No other auth header is needed.
            </li>
            <li>
              Header{" "}
              <code className="rounded bg-background px-1 py-0.5">
                Content-Type: {INGEST_REQUEST.contentType}
              </code>
            </li>
          </ul>
        </div>

        <CopyField label="Request body (JSON)" value={INGEST_BODY_EXAMPLE} />
        <p className="text-[11px] text-text-muted">
          <code className="rounded bg-background px-1 py-0.5">message</code>{" "}
          is the full SMS text and is required.{" "}
          <code className="rounded bg-background px-1 py-0.5">received_at</code>
          {" "}
          is optional (ISO-8601).
        </p>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            What to expect
          </span>
          <ul className="flex flex-col gap-0.5 text-xs text-text-secondary">
            <li>
              <code className="rounded bg-background px-1 py-0.5">
                {`{"ok":true}`}
              </code>{" "}
              — received (or a harmless duplicate).
            </li>
            <li>
              <code className="rounded bg-background px-1 py-0.5">401</code>{" "}
              — the key is wrong, revoked, or paused.
            </li>
            <li>
              <code className="rounded bg-background px-1 py-0.5">422</code>{" "}
              — that SMS had no{" "}
              <code className="rounded bg-background px-1 py-0.5">RWF</code>{" "}
              amount, so nothing was recorded.
            </li>
          </ul>
        </div>

        <Link
          href="/settings/connections/setup"
          className="text-xs font-medium text-accent hover:underline"
        >
          Full step-by-step Shortcut guide →
        </Link>
      </div>
    </details>
  );
}

/**
 * The compact block shown inside RevealedSecret right after a key is
 * created or rotated: enough to finish wiring the Shortcut without
 * leaving the page. The full reference lives in ConnectionDetails.
 */
export function ShortcutKeyInstructions({
  endpointUrl,
}: {
  endpointUrl: string | null;
}) {
  return (
    <>
      <p className="font-medium text-text-primary">iPhone Shortcut setup</p>
      <p className="mt-1">
        In your MoMo forwarding Shortcut&apos;s{" "}
        <span className="font-medium">Get Contents of URL</span> action:
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        <li>
          URL{" "}
          <code className="break-all rounded bg-surface px-1 py-0.5">
            {endpointUrl ?? "(your Supabase functions URL)/functions/v1/ingest-momo"}
          </code>
        </li>
        <li>
          Method <code className="rounded bg-surface px-1 py-0.5">POST</code>,
          header{" "}
          <code className="rounded bg-surface px-1 py-0.5">x-ingest-key</code>{" "}
          = the value above
        </li>
        <li>
          JSON body{" "}
          <code className="rounded bg-surface px-1 py-0.5">
            {`{"message": <SMS text>}`}
          </code>
        </li>
      </ul>
      <p className="mt-1">
        Save. Messages already forwarded are unaffected. Never built the
        automation?{" "}
        <Link
          href="/settings/connections/setup"
          className="font-medium text-accent hover:underline"
        >
          Follow the step-by-step guide
        </Link>
        .
      </p>
    </>
  );
}
