"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveBillDocument } from "../../app/bills/actions";

// Archive (never hard-delete) a bill document. A stored original under a
// retention obligation still archives; nothing is removed (master prompt
// §6). Requires an explicit confirm before the irreversible-ish action.

export function BillArchiveButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 rounded-control px-3 text-sm font-medium text-text-muted hover:text-text-primary"
      >
        Archive
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-secondary">
        Archive this document? It stays retrievable but leaves the active list.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await archiveBillDocument(id);
              if (result.ok) {
                router.refresh();
              } else {
                setError(result.error);
              }
            });
          }}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Archiving…" : "Archive"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-11 rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
