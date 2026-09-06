"use client";

import { useState, useTransition } from "react";
import { exportMyData } from "../app/settings/privacy/data/actions";

// Requests the JSON bundle from the server action, then hands it to the
// browser as a download. The bundle is assembled through the caller's own
// RLS-scoped session, so it only ever contains their own data.
export function DataExportButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await exportMyData();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            const blob = new Blob([result.json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = result.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          });
        }}
        className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Preparing…" : "Download my data"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
