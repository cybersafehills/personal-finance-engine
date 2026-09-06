"use client";

import { useMemo, useState, useTransition } from "react";
import {
  disableIngestEmail,
  enableIngestEmail,
  rotateIngestEmail,
} from "../app/settings/sources/import/actions";

type SourceOption = { id: string; label: string };

// ADR 0018 Slice B. Manages the per-source inbound address. Forwarding a
// bank's statement mail to this address gets it imported through the same
// path as a manual CSV upload (lines already in OneLedger are flagged for
// review, never duplicated). Rendered only when EMAIL_STATEMENT_INGEST_ENABLED.
export function EmailIngestPanel({
  sources,
  addresses: initialAddresses,
}: {
  sources: SourceOption[];
  addresses: Record<string, string>;
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [addresses, setAddresses] = useState<Record<string, string>>(
    initialAddresses,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const address = sourceId ? addresses[sourceId] ?? null : null;
  const selectedLabel = useMemo(
    () => sources.find((s) => s.id === sourceId)?.label ?? "",
    [sources, sourceId],
  );

  const run = (
    fn: (id: string) => Promise<
      { ok: true; address: string | null } | { ok: false; error: string }
    >,
  ) => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await fn(sourceId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAddresses((prev) => {
        const next = { ...prev };
        if (result.address) next[sourceId] = result.address;
        else delete next[sourceId];
        return next;
      });
    });
  };

  if (sources.length === 0) return null;

  return (
    <section className="mt-8 rounded-card border border-border p-4">
      <h2 className="text-base font-semibold">Email statements in</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Give one account a private address, then forward (or auto-send) your
        bank&rsquo;s statement emails to it. CSV attachments and plain-text
        transaction lists are read automatically.
      </p>

      <label className="mt-4 block text-sm font-medium" htmlFor="ingest-source">
        Account
      </label>
      <select
        id="ingest-source"
        value={sourceId}
        onChange={(e) => {
          setSourceId(e.target.value);
          setError(null);
          setCopied(false);
        }}
        className="mt-1 min-h-11 w-full rounded-control border border-border bg-surface px-3 text-sm"
      >
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      {address
        ? (
          <div className="mt-4">
            <p className="text-sm font-medium">Forwarding address</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="break-all rounded-control bg-muted px-2 py-1 text-sm">
                {address}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(address).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
                className="min-h-9 rounded-control border border-border px-3 text-sm"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Anyone with this address can add transactions to{" "}
              <span className="font-medium">{selectedLabel}</span>. Rotate it if
              it leaks.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(rotateIngestEmail)}
                className="min-h-11 rounded-control border border-border px-4 text-sm font-medium disabled:opacity-50"
              >
                Rotate address
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(disableIngestEmail)}
                className="min-h-11 rounded-control border border-border px-4 text-sm font-medium text-attention disabled:opacity-50"
              >
                Disable
              </button>
            </div>
          </div>
        )
        : (
          <button
            type="button"
            disabled={isPending || !sourceId}
            onClick={() => run(enableIngestEmail)}
            className="mt-4 min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {isPending ? "Generating…" : "Generate an address"}
          </button>
        )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-attention">
          {error}
        </p>
      )}
    </section>
  );
}
