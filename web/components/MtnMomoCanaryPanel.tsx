"use client";

import { useState, useTransition } from "react";
import {
  pairMtnMomoAdapterCanary,
  setMtnMomoAdapterCanaryEnabled,
} from "../app/settings/connections/actions";
import type { ConnectorAdapterCanaryStatus } from "../lib/queries";
import { Badge } from "./Badge";

export function MtnMomoCanaryPanel({
  connectionId,
  connectorInstallationId,
  canary,
}: {
  connectionId: string;
  connectorInstallationId: string | null;
  canary: ConnectorAdapterCanaryStatus | null;
}) {
  const [open, setOpen] = useState(false);
  const [msisdn, setMsisdn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (canary && connectorInstallationId) {
    const failures = canary.mismatch_count + canary.resolver_error_count +
      canary.envelope_error_count;
    return (
      <section className="rounded-control border border-border-subtle bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-text-secondary">
              MTN adapter canary
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {canary.observation_count} routed events · {canary.match_count}
              {" "}matches · {failures} failures
            </p>
          </div>
          <Badge
            variant={
              canary.ready_for_broader_rollout
                ? "positive"
                : canary.enabled
                  ? "neutral"
                  : "attention"
            }
          >
            {canary.ready_for_broader_rollout
              ? "Canary healthy"
              : canary.enabled
                ? "Evaluating"
                : "Canary paused"}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Broader rollout remains locked until at least five events route with
          no mismatch, resolver, or envelope failures.
        </p>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await setMtnMomoAdapterCanaryEnabled(
                connectorInstallationId,
                !canary.enabled,
              );
              if (!result.ok) setError(result.error);
            });
          }}
          className="mt-2 min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
        >
          {canary.enabled ? "Pause adapter canary" : "Resume adapter canary"}
        </button>
        {error && <p role="alert" className="mt-2 text-xs text-attention">{error}</p>}
      </section>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={!connectorInstallationId}
        onClick={() => setOpen(true)}
        className="w-fit min-h-8 text-xs font-medium text-accent hover:underline disabled:text-text-muted disabled:no-underline"
      >
        Pair MTN adapter canary
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-control border border-border-subtle bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await pairMtnMomoAdapterCanary(
            connectionId,
            msisdn,
          );
          if (result.ok) {
            setMsisdn("");
            setOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        <span className="font-medium">MTN mobile number</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={msisdn}
          onChange={(event) => setMsisdn(event.target.value)}
          placeholder="0788 123 456"
          className="min-h-10 rounded-control border border-border-strong bg-surface px-3 text-sm text-text-primary"
        />
      </label>
      <p className="text-xs text-text-muted">
        The number is normalized and hashed before pairing. Only its last four
        digits are retained for display. Pairing enables this installation
        only and does not alter the existing account route.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !msisdn.trim()}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Pairing…" : "Pair and start canary"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setMsisdn("");
            setError(null);
            setOpen(false);
          }}
          className="min-h-9 text-xs font-medium text-text-muted"
        >
          Cancel
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-attention">{error}</p>}
    </form>
  );
}
