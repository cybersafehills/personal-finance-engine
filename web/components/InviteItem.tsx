"use client";

import { useState, useTransition } from "react";
import { resendInvite, revokeInvite } from "../app/settings/workspace/actions";
import { RevealedSecret } from "./RevealedSecret";
import { formatDateTime } from "../lib/format";
import type { WorkspaceInviteRow } from "../lib/queries";

export function InviteItem({ invite }: { invite: WorkspaceInviteRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<
    { link: string; emailSent: boolean } | null
  >(null);

  const expired = invite.expired;

  if (revealed) {
    return (
      <RevealedSecret
        secret={revealed.link}
        onDismiss={() => setRevealed(null)}
        instructions={
          <p>
            {revealed.emailSent
              ? `A fresh link was emailed to ${invite.email}. `
              : "We couldn't send this by email — share it yourself. "}
            The previous link no longer works.
          </p>
        }
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div>
        <p className="text-sm font-medium text-text-primary">{invite.email}</p>
        <p className="text-xs text-text-muted">
          {invite.role}
          {" · "}
          {expired
            ? <span className="text-attention">expired</span>
            : `expires ${formatDateTime(invite.expiresAt)}`}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-attention">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await resendInvite(invite.id);
              if (result.ok) {
                setRevealed({ link: result.link, emailSent: result.emailSent });
              } else {
                setError(result.error);
              }
            });
          }}
          className="min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
        >
          {expired ? "Send a new link" : "Resend"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await revokeInvite(invite.id);
              if (!result.ok) setError(result.error);
            });
          }}
          className="min-h-8 text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
        >
          {isPending ? "Working…" : "Revoke"}
        </button>
      </div>
    </div>
  );
}
