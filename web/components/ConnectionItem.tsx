"use client";

import { useState, useTransition } from "react";
import {
  pauseConnection,
  renameConnection,
  resumeConnection,
  revokeConnection,
  rotateConnection,
} from "../app/integrations/connections/actions";
import { Badge } from "./Badge";
import { RevealedSecret } from "./RevealedSecret";
import { ConnectionDetails, ShortcutKeyInstructions } from "./ConnectionDetails";
import { ConnectionReadinessProbe } from "./ConnectionReadinessProbe";
import { ReconnectPhone } from "./ReconnectPhone";
import type { ConnectionHealth } from "../lib/connection-health";
import { formatDateTime } from "../lib/format";
import type { IngestionConnectionRow } from "../lib/queries";
import { MtnMomoCanaryPanel } from "./MtnMomoCanaryPanel";

const PROVIDER_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  other: "Other",
};

type StatusView = {
  label: string;
  variant: "positive" | "neutral" | "attention";
  /** One plain sentence under the name. */
  line: string;
  /** Extra nudge, only when the phone looks stuck. */
  hint?: string;
};

/**
 * Plain-language status from what the app can actually observe (status +
 * last_used_at, see lib/connection-health.ts). We never claim a phone is
 * "broken" - only that nothing has arrived for a while - because a quiet
 * account is legitimate.
 */
function statusView(
  connection: IngestionConnectionRow,
  health: ConnectionHealth,
): StatusView {
  const last = connection.last_used_at
    ? formatDateTime(connection.last_used_at)
    : null;
  switch (health.state) {
    case "removed":
      return {
        label: "Removed",
        variant: "attention",
        line: "This phone is disconnected. Reconnect to start again.",
      };
    case "paused":
      return {
        label: "Paused",
        variant: "neutral",
        line: "Messages from this phone are ignored until you resume.",
      };
    case "waiting":
      return {
        label: "Waiting",
        variant: "neutral",
        line: "No message yet. Your next transaction message will be the first.",
      };
    case "quiet":
      return {
        label: "Quiet",
        variant: "attention",
        line: `Last message: ${last}.`,
        hint: `Nothing for ${health.quietDays} day${
          health.quietDays === 1 ? "" : "s"
        }. Paid or received since? Tap Reconnect.`,
      };
    default:
      return {
        label: "Working",
        variant: "positive",
        line: `Last message: ${last}.`,
      };
  }
}

export function ConnectionItem({
  connection,
  ingestEndpointUrl,
  canManageAdapterCanary,
  health,
  canReconnect,
}: {
  connection: IngestionConnectionRow;
  ingestEndpointUrl: string | null;
  canManageAdapterCanary: boolean;
  health: ConnectionHealth;
  /** Device pairing v2 is on: the guided reconnect flow is available. */
  canReconnect: boolean;
}) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState(connection.label);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const status = statusView(connection, health);
  const isRevoked = connection.status === "revoked";
  const isPaused = connection.status === "paused";
  const neverUsed = !connection.last_used_at;
  const idle = !renaming && !confirmingRevoke && !confirmingRotate &&
    !reconnecting;

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

  const details = (
    <ConnectionDetails
      endpointUrl={ingestEndpointUrl}
      defaultOpen={neverUsed && connection.status === "active"}
    />
  );

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-text-primary">
            {connection.label}
          </span>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <p className="text-xs text-text-muted">
          {PROVIDER_LABELS[connection.provider] ?? connection.provider} →{" "}
          {connection.account_name}
        </p>
        <p className="text-sm text-text-secondary">{status.line}</p>
        {status.hint && (
          <p className="text-sm font-medium text-attention">{status.hint}</p>
        )}
      </div>

      {reconnecting && canReconnect && (
        <ReconnectPhone
          accountId={connection.account_id}
          onClose={() => setReconnecting(false)}
        />
      )}

      {idle && canReconnect && (
        <button
          type="button"
          onClick={() => {
            setErrorMessage(null);
            setReconnecting(true);
          }}
          className={`inline-flex min-h-11 w-fit items-center rounded-control px-4 text-sm font-medium ${
            health.state === "quiet" || health.state === "removed"
              ? "bg-accent text-accent-foreground"
              : "border border-border-strong text-text-primary"
          }`}
        >
          Reconnect this phone
        </button>
      )}

      {connection.status === "active" && neverUsed && (
        <ConnectionReadinessProbe connectionId={connection.id} />
      )}

      {/* A never-used connection is mid-setup: show the manual details up
          front. Once it works they move under Advanced. */}
      {!isRevoked && neverUsed && details}

      {canManageAdapterCanary && connection.provider === "mtn_momo" &&
        !isRevoked && (
        <MtnMomoCanaryPanel
          connectionId={connection.id}
          connectorInstallationId={connection.connector_installation_id}
          canary={connection.adapter_canary}
        />
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

      {!isRevoked && idle && (
        <div className="flex flex-wrap items-center gap-4">
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
              title="Ignore messages from this phone until you resume"
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
            Remove
          </button>
        </div>
      )}

      {!isRevoked && confirmingRevoke && (
        <div className="flex flex-col gap-2 rounded-control bg-background p-3">
          <p className="text-sm text-text-secondary">
            Remove this phone? It stops sending now. You can reconnect it any
            time. Past transactions stay.
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
              {isPending ? "Removing…" : "Yes, remove"}
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

      {!isRevoked && !neverUsed && (
        <details className="rounded-control border border-border-subtle">
          <summary className="min-h-11 cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-text-muted [&::-webkit-details-marker]:hidden">
            Advanced
          </summary>
          <div className="flex flex-col gap-3 border-t border-border-subtle px-3 py-3">
            <p className="text-xs text-text-muted">
              For hand-built Shortcuts only. Most people never need this.
            </p>
            {details}
            {!isPaused && !confirmingRotate && (
              <button
                type="button"
                onClick={() => setConfirmingRotate(true)}
                className="min-h-8 w-fit text-xs font-medium text-accent hover:underline"
              >
                Make a new key
              </button>
            )}
            {confirmingRotate && (
              <div className="flex flex-col gap-2 rounded-control bg-background p-3">
                <p className="text-sm text-text-secondary">
                  The old key stops working at once. Your phone sends nothing
                  until you put the new key in its Shortcut.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      setErrorMessage(null);
                      startTransition(async () => {
                        const result = await rotateConnection(connection.id);
                        if (result.ok) {
                          setConfirmingRotate(false);
                          setRevealedSecret(result.secret);
                        } else {
                          setErrorMessage(result.error);
                        }
                      });
                    }}
                    className="min-h-8 rounded-control bg-attention px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
                  >
                    {isPending ? "Working…" : "Make new key"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRotate(false)}
                    className="min-h-8 text-xs font-medium text-text-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
