"use client";

import { useState, useTransition } from "react";
import {
  revokeConnection,
  rotateConnection,
} from "../app/settings/connections/actions";
import { Badge } from "./Badge";
import { RevealedSecret } from "./RevealedSecret";
import { formatDateTime } from "../lib/format";
import type { IngestionConnectionRow } from "../lib/queries";

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
  if (connection.last_used_at) {
    return { label: "Ready", variant: "positive" };
  }
  return { label: "Not configured", variant: "neutral" };
}

export function ConnectionItem({
  connection,
}: {
  connection: IngestionConnectionRow;
}) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const status = connectionStatus(connection);
  const isRevoked = connection.status === "revoked";

  if (revealedSecret) {
    return (
      <RevealedSecret
        secret={revealedSecret}
        onDismiss={() => setRevealedSecret(null)}
        instructions={
          <>
            <p className="font-medium text-text-primary">
              iPhone Shortcut setup
            </p>
            <p className="mt-1">
              In your MTN MoMo forwarding Shortcut, set the{" "}
              <code className="rounded bg-surface px-1 py-0.5">
                x-ingest-key
              </code>{" "}
              header to the value above, then save. Existing forwarded
              messages are unaffected.
            </p>
          </>
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

      {!isRevoked && !confirmingRevoke && (
        <div className="flex flex-wrap items-center gap-4 pt-1">
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
