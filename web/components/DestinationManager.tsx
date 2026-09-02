"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./Badge";
import { RevealedSecret } from "./RevealedSecret";
import {
  createDestination,
  deleteDestination,
  rotateWebhookSecret,
  testDestination,
} from "../app/integrations/sync/actions";
import type { IntegrationDestination } from "../lib/integrations/destinations/model";

const KIND_LABEL: Record<string, string> = {
  download: "Download only",
  webhook: "Signed webhook",
  cloud_storage: "Cloud storage",
  connected_workbook: "Connected workbook",
};

export function DestinationManager({
  destinations,
}: {
  destinations: IntegrationDestination[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"download" | "webhook">("webhook");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function refresh() {
    router.refresh();
  }

  function add() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await createDestination({
        name,
        kind,
        url: kind === "webhook" ? url : undefined,
      });
      if (result.ok) {
        setName("");
        setUrl("");
        setAdding(false);
        if (result.secret) setSecret(result.secret);
        else setNotice("Destination added.");
        refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function rowAction(fn: () => Promise<{ ok: boolean; error?: string; secret?: string }>) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        if ("secret" in result && result.secret) setSecret(result.secret);
        else setNotice("Done.");
        refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  if (secret) {
    return (
      <RevealedSecret
        secret={secret}
        onDismiss={() => setSecret(null)}
        instructions={
          <p className="text-xs text-text-muted">
            Your endpoint verifies each delivery: HMAC-SHA256 of{" "}
            <code>{`{X-OneLedger-Timestamp}.{body}`}</code> with this secret,
            compared to <code>X-OneLedger-Signature</code>.
          </p>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-control border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
          {notice}
        </p>
      )}

      {destinations.length === 0 ? (
        <p className="text-sm text-text-muted">No destinations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {destinations.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">{d.name}</span>
                <span className="block text-xs text-text-muted">
                  {KIND_LABEL[d.kind] ?? d.kind}
                  {d.kind === "webhook" && (d.config as { url?: string }).url
                    ? ` · ${(d.config as { url?: string }).url}`
                    : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge
                  variant={d.status === "active" ? "positive" : d.status === "error" ? "attention" : "neutral"}
                >
                  {d.status}
                </Badge>
                {d.kind === "webhook" && (
                  <>
                    <button type="button" disabled={isPending} onClick={() => rowAction(() => testDestination(d.id))} className="rounded-control border border-border-subtle bg-background px-3 py-1 text-sm font-medium disabled:opacity-50">
                      Test
                    </button>
                    <button type="button" disabled={isPending} onClick={() => rowAction(() => rotateWebhookSecret(d.id))} className="rounded-control border border-border-subtle bg-background px-3 py-1 text-sm font-medium disabled:opacity-50">
                      Rotate secret
                    </button>
                  </>
                )}
                <button type="button" disabled={isPending} onClick={() => rowAction(() => deleteDestination(d.id))} className="rounded-control px-3 py-1 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Destination name"
            maxLength={80}
            className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
          />
          <div className="flex gap-4 text-sm">
            {(["webhook", "download"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name="destKind" checked={kind === k} onChange={() => setKind(k)} />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
          {kind === "webhook" && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.example.com/oneledger"
              className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
            />
          )}
          <div className="flex gap-2">
            <button type="button" disabled={!name.trim() || isPending} onClick={add} className="min-h-11 rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50">
              {isPending ? "Adding…" : "Add destination"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="min-h-11 rounded-control px-3 text-sm font-medium text-text-secondary hover:bg-background">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="min-h-11 self-start rounded-control border border-border-subtle bg-surface px-4 text-sm font-medium text-text-primary">
          Add destination
        </button>
      )}
    </div>
  );
}
