"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
} from "../app/settings/privacy/data/actions";
import type { AccountDeletionRequest } from "../lib/account-deletion";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Africa/Kigali",
  });
}

export function AccountDeletionControls({
  request,
}: {
  request: AccountDeletionRequest | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const scheduled = request?.status === "scheduled";

  if (scheduled && request) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-attention bg-surface p-4">
        <p className="text-sm font-medium text-text-primary">
          Deletion scheduled for {formatDate(request.scheduledFor)}.
        </p>
        <p className="text-sm text-text-muted">
          Your account and its data will be permanently removed on that
          date. You can cancel any time before then.
        </p>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await cancelAccountDeletion();
              if (result.ok) router.refresh();
              else setError(result.error);
            });
          }}
          className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          Cancel deletion
        </button>
        {error && (
          <p role="alert" className="text-sm text-attention">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!confirming
        ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-11 w-fit rounded-control border border-attention px-4 text-sm font-medium text-attention"
          >
            Delete my account
          </button>
        )
        : (
          <div className="flex flex-col gap-3 rounded-card border border-attention bg-surface p-4">
            <p className="text-sm text-text-primary">
              This schedules permanent deletion of your account and its
              data in <strong>30 days</strong>. Export your data first if
              you want to keep it. You can cancel within the 30 days.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-secondary">
                Reason (optional)
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-base text-text-primary"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await requestAccountDeletion(reason);
                    if (result.ok) router.refresh();
                    else setError(result.error);
                  });
                }}
                className="min-h-11 rounded-control bg-attention px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                Schedule deletion
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                }}
                className="min-h-11 rounded-control px-4 text-sm font-medium text-text-muted"
              >
                Keep my account
              </button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-attention">
                {error}
              </p>
            )}
          </div>
        )}
    </div>
  );
}
