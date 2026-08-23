"use client";

import { useState, useTransition } from "react";
import {
  archiveAccount,
  renameAccount,
  setPrimaryAccount,
} from "../app/settings/accounts/actions";
import { Badge } from "./Badge";
import type { AccountRow } from "../lib/queries";

const PROVIDER_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  other: "Other",
};

export function AccountItem({ account }: { account: AccountRow }) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(account.name);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isArchived = !account.is_active;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setErrorMessage(null);
                startTransition(async () => {
                  const result = await renameAccount(account.id, name);
                  if (result.ok) {
                    setIsRenaming(false);
                  } else {
                    setErrorMessage(result.error);
                  }
                });
              }}
            >
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
                className="min-h-9 flex-1 rounded-control border border-border-strong bg-background px-2 py-1 text-sm text-text-primary"
              />
              <button
                type="submit"
                disabled={isPending}
                className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRenaming(false);
                  setName(account.name);
                  setErrorMessage(null);
                }}
                className="min-h-9 rounded-control px-2 text-xs font-medium text-text-muted"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-text-primary">
                {account.name}
              </span>
              {account.is_primary && <Badge variant="accent">Primary</Badge>}
              {isArchived && <Badge variant="attention">Archived</Badge>}
            </div>
          )}
          <p className="mt-0.5 text-xs text-text-muted">
            {PROVIDER_LABELS[account.provider] ?? account.provider} ·{" "}
            {account.currency}
          </p>
        </div>
      </div>

      {!isRenaming && !isArchived && (
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            type="button"
            onClick={() => setIsRenaming(true)}
            className="min-h-8 text-xs font-medium text-accent hover:underline"
          >
            Rename
          </button>
          {!account.is_primary && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setErrorMessage(null);
                startTransition(async () => {
                  const result = await setPrimaryAccount(account.id);
                  if (!result.ok) setErrorMessage(result.error);
                });
              }}
              className="min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
            >
              Set as primary
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setErrorMessage(null);
              startTransition(async () => {
                const result = await archiveAccount(account.id);
                if (!result.ok) setErrorMessage(result.error);
              });
            }}
            className="min-h-8 text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
