"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveAccount,
  renameAccount,
  setPrimaryAccount,
} from "../app/settings/accounts/actions";

// The account-management controls (rename / set primary / archive) for the
// account detail page's Settings tab (master prompt section 16/24). Reuses
// the exact server actions the /settings/accounts list uses - one write
// path. The list keeps its own inline copy for quick edits; this is the
// full-object home.
export function AccountSettingsControls({
  accountId,
  name,
  isPrimary,
  isArchived,
}: {
  accountId: string;
  name: string;
  isPrimary: boolean;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [draftName, setDraftName] = useState(name);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  if (isArchived) {
    return (
      <p className="text-sm text-text-muted">
        This account is archived. Its history stays in your ledger and
        reports; it can no longer receive new transactions.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => renameAccount(accountId, draftName));
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Account name</span>
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            required
            maxLength={80}
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-base text-text-primary"
          />
        </label>
        <button
          type="submit"
          disabled={isPending || draftName.trim() === name}
          className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          Save name
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-4 border-t border-border-subtle pt-4">
        {!isPrimary && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setPrimaryAccount(accountId))}
            className="min-h-9 text-sm font-medium text-accent hover:underline disabled:opacity-50"
          >
            Set as primary account
          </button>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => archiveAccount(accountId))}
          className="min-h-9 text-sm font-medium text-text-muted hover:text-attention disabled:opacity-50"
        >
          Archive account
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-text-secondary">
          Saved.
        </p>
      )}
    </div>
  );
}
