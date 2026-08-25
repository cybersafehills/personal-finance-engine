"use client";

import { useTransition } from "react";
import { revokeInvite } from "../app/settings/workspace/actions";
import { formatDateTime } from "../lib/format";
import type { WorkspaceInviteRow } from "../lib/queries";

export function InviteItem({ invite }: { invite: WorkspaceInviteRow }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div>
        <p className="text-sm font-medium text-text-primary">{invite.email}</p>
        <p className="text-xs text-text-muted">
          {invite.role} · expires {formatDateTime(invite.expiresAt)}
        </p>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await revokeInvite(invite.id);
          })
        }
        className="min-h-8 text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
      >
        {isPending ? "Revoking…" : "Revoke"}
      </button>
    </div>
  );
}
