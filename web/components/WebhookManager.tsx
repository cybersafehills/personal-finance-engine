"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./Badge";
import { RevealedSecret } from "./RevealedSecret";
import {
  createWebhook,
  deleteWebhook,
  rotateWebhookSecret,
  sendWebhookPing,
  updateWebhook,
} from "../app/integrations/developer/webhook-actions";
import { WEBHOOK_EVENTS } from "../lib/integrations/webhooks/events";
import type {
  WebhookDeliverySummary,
  WebhookSubscriptionSummary,
} from "../lib/integrations/webhooks/events";
import { formatDateTime } from "../lib/format";

function statusVariant(
  s: WebhookSubscriptionSummary["status"],
): "positive" | "neutral" | "attention" {
  if (s === "failing") return "attention";
  if (s === "active") return "positive";
  return "neutral";
}

export function WebhookManager({
  subscriptions,
  deliveries,
}: {
  subscriptions: WebhookSubscriptionSummary[];
  deliveries: WebhookDeliverySummary[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Set<string>>(
    new Set(WEBHOOK_EVENTS.filter((e) => e !== "webhook.ping")),
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; secret?: string }>,
    ok?: string,
  ) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        if ("secret" in result && result.secret) setSecret(result.secret);
        else if (ok) setNotice(ok);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  function toggleEvent(e: string) {
    const next = new Set(events);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    setEvents(next);
  }

  function add() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await createWebhook({ url, eventTypes: [...events] });
      if (result.ok) {
        setUrl("");
        setAdding(false);
        setSecret(result.secret);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (secret) {
    return (
      <RevealedSecret
        secret={secret}
        onDismiss={() => setSecret(null)}
        instructions={
          <>
            Verify each request:{" "}
            <code>
              {`HMAC_SHA256(secret, X-OneLedger-Timestamp + "." + body)`}
            </code>{" "}
            must equal <code>X-OneLedger-Signature</code>. Reject a timestamp
            more than a few minutes old.
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-control border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
          {notice}
        </p>
      )}

      {subscriptions.length === 0 && !adding && (
        <p className="text-sm text-text-muted">No webhook endpoints yet.</p>
      )}

      <ul className="flex flex-col gap-2">
        {subscriptions.map((s) => (
          <li
            key={s.id}
            className="rounded-card border border-border-subtle bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {s.url}
                </span>
                <span className="block text-xs text-text-muted">
                  {s.eventTypes.join(", ")}
                  {s.secretPrefix ? ` · ${s.secretPrefix}…` : ""}
                  {s.lastErrorCode ? ` · last error: ${s.lastErrorCode}` : ""}
                </span>
              </span>
              <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => sendWebhookPing(s.id), "Test event queued.")}
                className="font-medium text-accent hover:underline disabled:opacity-50"
              >
                Send test
              </button>
              {(s.status === "paused" || s.status === "failing") && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => updateWebhook(s.id, { status: "active" }))}
                  className="font-medium text-text-secondary hover:underline disabled:opacity-50"
                >
                  Resume
                </button>
              )}
              {s.status === "active" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => updateWebhook(s.id, { status: "paused" }))}
                  className="font-medium text-text-secondary hover:underline disabled:opacity-50"
                >
                  Pause
                </button>
              )}
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => rotateWebhookSecret(s.id))}
                className="font-medium text-text-secondary hover:underline disabled:opacity-50"
              >
                Rotate secret
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (window.confirm("Delete this webhook endpoint?")) {
                    run(() => deleteWebhook(s.id), "Webhook deleted.");
                  }
                }}
                className="font-medium text-attention hover:underline disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {adding
        ? (
          <div className="rounded-card border border-border-subtle bg-surface p-4">
            <label className="block text-sm font-medium text-text-secondary">
              Endpoint URL (https)
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/oneledger"
                className="mt-1 block w-full rounded-md border border-border-subtle bg-background px-3 py-2 text-base"
              />
            </label>
            <fieldset className="mt-3">
              <legend className="text-sm font-medium text-text-secondary">
                Events
              </legend>
              <div className="mt-1 flex flex-col gap-1">
                {WEBHOOK_EVENTS.filter((e) => e !== "webhook.ping").map((e) => (
                  <label key={e} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={events.has(e)}
                      onChange={() => toggleEvent(e)}
                    />
                    <code>{e}</code>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={isPending || !url.trim() || events.size === 0}
                onClick={add}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                Add webhook
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-text-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )
        : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="self-start rounded-md border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-text-primary hover:bg-background"
          >
            Add a webhook endpoint
          </button>
        )}

      {deliveries.length > 0 && (
        <div className="mt-2">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Recent deliveries
          </h3>
          <ul className="flex flex-col gap-1">
            {deliveries.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-control border border-border-subtle bg-surface px-3 py-2 text-xs"
              >
                <span className="text-text-secondary">
                  {d.eventType} · {formatDateTime(d.createdAt)}
                  {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
                  {d.errorCode ? ` · ${d.errorCode}` : ""}
                </span>
                <Badge
                  variant={d.status === "delivered"
                    ? "positive"
                    : d.status === "failed"
                    ? "attention"
                    : "neutral"}
                >
                  {d.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
