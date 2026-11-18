"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setActiveWorkspace } from "../app/settings/workspace/actions";

/** One tap to make another Space the active one, then reload what is on screen. */
export function SwitchSpaceButton({
  workspaceId,
  name,
  className,
}: {
  workspaceId: string;
  name: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await setActiveWorkspace(workspaceId);
            if (!res.ok) setError(res.error);
            else router.refresh();
          });
        }}
        className={className ??
          "min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"}
      >
        {pending ? "Switching…" : `Switch to ${name}`}
      </button>
      {error ? <span role="alert" className="text-xs text-attention">{error}</span> : null}
    </span>
  );
}
