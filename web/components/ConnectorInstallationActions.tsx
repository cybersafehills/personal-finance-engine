"use client";

import { useState, useTransition } from "react";
import {
  pauseConnectorInstallation,
  renameConnectorInstallation,
  revokeConnectorInstallation,
  resumeConnectorInstallation,
} from "../app/settings/connections/actions";
import type { CanonicalConnectorInstallation } from "../lib/connector-read-model";

type ActionResult = { ok: true } | { ok: false; error: string };

export function ConnectorInstallationActions({
  installationId,
  displayName,
  status,
}: {
  installationId: string;
  displayName: string;
  status: CanonicalConnectorInstallation["status"];
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isPaused = status === "paused";

  const run = (action: () => Promise<ActionResult>) => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setRenaming(false);
      setConfirmingRevoke(false);
    });
  };

  if (status === "revoked") return null;

  return (
    <div className="border-t border-border-subtle pt-3">
      {renaming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-control bg-background p-3">
          <input
            type="text"
            value={draftName}
            disabled={isPending}
            onChange={(event) => setDraftName(event.target.value)}
            aria-label="Connector name"
            className="min-h-8 flex-1 rounded-control border border-border-subtle bg-surface px-2 text-sm text-text-primary"
          />
          <button
            type="button"
            disabled={isPending || !draftName.trim()}
            onClick={() =>
              run(() => renameConnectorInstallation(installationId, draftName))}
            className="min-h-8 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setDraftName(displayName);
              setRenaming(false);
              setErrorMessage(null);
            }}
            className="min-h-8 text-xs font-medium text-text-muted disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : confirmingRevoke ? (
        <div className="flex flex-col gap-2 rounded-control bg-background p-3">
          <p className="text-xs text-text-secondary">
            Revoking permanently disables this connector and every credential
            enrolled under it. Existing transaction provenance is retained.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(() => revokeConnectorInstallation(installationId))}
              className="min-h-8 rounded-control bg-attention px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
            >
              {isPending ? "Revoking…" : "Confirm revoke"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmingRevoke(false)}
              className="min-h-8 text-xs font-medium text-text-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              run(() =>
                isPaused
                  ? resumeConnectorInstallation(installationId)
                  : pauseConnectorInstallation(installationId)
              )}
            className="min-h-8 text-xs font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            {isPaused ? "Resume connector" : "Pause connector"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setErrorMessage(null);
              setDraftName(displayName);
              setRenaming(true);
            }}
            className="min-h-8 text-xs font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            Rename
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setErrorMessage(null);
              setConfirmingRevoke(true);
            }}
            className="min-h-8 text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
          >
            Revoke connector
          </button>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
