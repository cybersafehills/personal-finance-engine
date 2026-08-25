"use client";

import { useState, useTransition } from "react";
import { signOutOtherSessions } from "./actions";

export function SignOutOthersButton() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setDone(false);
          startTransition(async () => {
            const result = await signOutOtherSessions();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setDone(true);
          });
        }}
        className="min-h-11 self-start rounded-control border border-border-strong bg-surface px-4 text-sm font-medium text-text-primary transition-colors hover:bg-background disabled:opacity-50"
      >
        {isPending ? "Signing out other sessions…" : "Sign out of other sessions"}
      </button>

      {done && (
        <p className="text-sm text-text-muted">
          Every other session has been signed out. This one is unaffected.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
