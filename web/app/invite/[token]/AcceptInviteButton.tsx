"use client";

import { useState, useTransition } from "react";
import { acceptInvite } from "./actions";

export function AcceptInviteButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await acceptInvite(token);
            if (!result.ok) setError(result.error);
          });
        }}
        className="min-h-11 rounded-control bg-accent px-6 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Joining…" : "Accept invite"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
