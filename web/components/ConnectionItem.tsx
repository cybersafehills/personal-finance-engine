"use client";

import { useState, useTransition } from "react";
import {
  pauseConnection,
  renameConnection,
  resumeConnection,
  revokeConnection,
  rotateConnection,
} from "../app/settings/connections/actions";
import { Badge } from "./Badge";
import { RevealedSecret } from "./RevealedSecret";
import { ConnectionDetails, ShortcutKeyInstructions } from "./ConnectionDetails";
import { ConnectionReadinessProbe } from "./ConnectionReadinessProbe";
import { formatDateTime } from "../lib/format";
import type { IngestionConnectionRow } from "../lib/queries";
import { MtnMomoCanaryPanel } from "./MtnMomoCanaryPanel";

const PROVIDER_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  other: "Other",
};

/**
 * Status shown is derived only from what the app can actually observe
 * (status + last_used_at) - "Not configured" vs "Ready" vs "Disabled".
 * The master prompt's illustrative state set also includes "Connecting"
 * and "Needs attention", but nothing in the current data model
 * distinguishes those from "Not configured" without fabricating a signal
 * the app doesn't have, so they aren't surfaced.
 */
function connectionStatus(
  connection: IngestionConnectionRow,
): { label: string; variant: "positive" | "neutral" | "attention" } {
  if (connection.status === "revoked") {
    return { label: "Disabled", variant: "attention" };
  }
  if (connection.status === "paused") {
    return { label: "Paused", variant: "neutral" };
  }
  if (connection.last_used_at) {
    return { label: "Ready", variant: "positive" };
  }
  return { label: "Not configured", variant: "neutral" };
}

export function ConnectionItem({
  connection,
  ingestEndpointUrl,
  canManageAdapterCanary,
}: {
  connection: IngestionConnectionRow;
  ingestEndpointUrl: string | null;
  canManageAdapterCanary: boolean;
}) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState(connection.label);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const status = connectionStatus(connection);
  const isRevoked = connection.status === "revoked";
  const isPaused = connection.status === "paused";

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setErrorMessage(result.error);
      else {
        setConfirmingRevoke(false);
        setRenaming(false);
      }
    });
  };

  if (revealedSecret) {
    return (
      <RevealedSecret
        secret={revealedSecret}
        onDismiss={() => setRevealedSecret(null)}
        instructions={
          <ShortcutKeyInstructions endpointUrl={ingestEndpointUrl} />
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text-primary">
          {connection.label}
        </span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <p className="text-xs text-text-muted">
        {PROVIDER_LABELS[connection.provider] ?? connection.provider} →{" "}
        {connection.account_name}
      </p>
      <p className="text-xs text-text-muted">
        <code className="rounded bg-background px-1 py-0.5">
          {connection.credential_prefix}…
        </code>
        {" · "}
        {connection.last_used_at
          ? `Last used ${formatDateTime(connection.last_used_at)}`
          : "Never used yet"}
      </p>

      {!isRevoked && (
        <ConnectionDetails
          endpointUrl={ingestEndpointUrl}
          defaultOpen={!connection.last_used_at && connection.status === "active"}
        />
      )}

      {connection.status === "active" && !connection.last_used_at && (
        <ConnectionReadinessProbe connectionId={connection.id} />
      )}

      {canManageAdapterCanary && connection.provider === "mtn_momo" &&
        !isRevoked && (
        <MtnMomoCanaryPanel
          connectionId={connection.id}
          connectorInstallationId={connection.connector_installation_id}
          canary={connection.adapter_canary}
        />
      )}

      {isPaused && !renaming && (
        <p className="text-xs text-text-secondary">
          Paused
          {connection.paused_at
            ? ` ${formatDateTime(connection.paused_at)}`
            : ""}
          . The device keeps its credential but can&apos;t send transactions
          in until you resume it.
        </p>
      )}

      {!isRevoked && renaming && (
        <div className="flex flex-wrap items-center gap-2 rounded-control bg-background p-3">
          <input
            type="text"
            value={draftLabel}
            disabled={isPending}
            onChange={(e) => setDraftLabel(e.target.value)}
            aria-label="Connection name"
            className="min-h-8 flex-1 rounded-control border border-border-subtle bg-surface px-2 text-sm text-text-primary"
          />
          <button
            type="button"
            disabled={isPending || !draftLabel.trim()}
            onClick={() => run(() =>
              renameConnection(connection.id, draftLabel))}
            className="min-h-8 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftLabel(connection.label);
              setRenaming(false);
            }}
            className="min-h-8 text-xs font-medium text-text-muted"
          >
            Cancel
          </button>
        </div>
      )}

      {!isRevoked && !confirmingRevoke && !renaming && (
        <div className="flex flex-wrap items-center gap-4 pt-1">
          {!isPaused && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setErrorMessage(null);
                startTransition(async () => {
                  const result = await rotateConnection(connection.id);
                  if (result.ok) {
                    setRevealedSecret(result.secret);
                  } else {
                    setErrorMessage(result.error);
                  }
                });
              }}
              className="min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
            >
              Rotate credential
            </button>
          )}
          {isPaused ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => resumeConnection(connection.id))}
              className="min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
            >
              Resume
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => pauseConnection(connection.id))}
              className="min-h-8 text-xs font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
            >
              Pause
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setErrorMessage(null);
              setDraftLabel(connection.label);
              setRenaming(true);
            }}
            className="min-h-8 text-xs font-medium text-text-muted hover:text-text-primary"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRevoke(true)}
            className="min-h-8 text-xs font-medium text-text-muted hover:text-attention"
          >
            Revoke
          </button>
        </div>
      )}

      {!isRevoked && confirmingRevoke && (
        <div className="flex flex-col gap-2 rounded-control bg-background p-3">
          <p className="text-xs text-text-secondary">
            Revoking disables this connection immediately. Any device using
            it will stop being able to send transactions in.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setErrorMessage(null);
                startTransition(async () => {
                  const result = await revokeConnection(connection.id);
                  if (result.ok) {
                    setConfirmingRevoke(false);
                  } else {
                    setErrorMessage(result.error);
                  }
                });
              }}
              className="min-h-8 rounded-control bg-attention px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
            >
              {isPending ? "Revoking…" : "Confirm revoke"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRevoke(false)}
              className="min-h-8 text-xs font-medium text-text-muted"
            >
              Cancel
            </button>
          </div>
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
