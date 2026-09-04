"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./Badge";
import { RevealedSecret } from "./RevealedSecret";
import {
  createApiKey,
  renameApiKey,
  revokeApiKey,
} from "../app/integrations/developer/actions";
import { API_SCOPES, type ApiKeySummary } from "../lib/api/keys";
import { formatDateTime } from "../lib/format";

export function ApiKeyManager({ keys }: { keys: ApiKeySummary[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set(API_SCOPES));
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk?: () => void,
  ) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  function toggleScope(s: string) {
    const next = new Set(scopes);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setScopes(next);
  }

  function add() {
    setError(null);
    start(async () => {
      const result = await createApiKey({ name, scopes: [...scopes] });
      if (result.ok) {
        setSecret(result.secret);
        setName("");
        setAdding(false);
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
            Use it as a bearer token:{" "}
            <code>{`Authorization: Bearer ${secret.slice(0, 8)}…`}</code>. Base
            URL <code>/api/v1</code>. It is only shown once — store it in your
            secret manager now.
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

      {keys.length === 0 && !adding && (
        <p className="text-sm text-text-muted">No API keys yet.</p>
      )}

      <ul className="flex flex-col gap-2">
        {keys.map((k) => (
          <li
            key={k.id}
            className="rounded-card border border-border-subtle bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  {k.name}
                </span>
                <span className="block text-xs text-text-muted">
                  <code>{k.keyPrefix}…</code> · {k.scopes.join(", ") || "no scopes"}
                  {" · "}
                  {k.lastUsedAt
                    ? `last used ${formatDateTime(k.lastUsedAt)}`
                    : "never used"}
                </span>
              </span>
              <Badge variant={k.status === "active" ? "positive" : "neutral"}>
                {k.status}
              </Badge>
            </div>
            {k.status === "active" && (
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    const next = window.prompt("Rename this key", k.name);
                    if (next && next.trim() && next.trim() !== k.name) {
                      run(() => renameApiKey(k.id, next.trim()));
                    }
                  }}
                  className="font-medium text-text-secondary hover:underline disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (window.confirm(`Revoke "${k.name}"? This cannot be undone.`)) {
                      run(() => revokeApiKey(k.id));
                    }
                  }}
                  className="font-medium text-attention hover:underline disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding
        ? (
          <div className="rounded-card border border-border-subtle bg-surface p-4">
            <label className="block text-sm font-medium text-text-secondary">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="mt-1 block w-full rounded-md border border-border-subtle bg-background px-3 py-2 text-base"
              />
            </label>
            <fieldset className="mt-3">
              <legend className="text-sm font-medium text-text-secondary">
                Scopes
              </legend>
              <div className="mt-1 flex flex-col gap-1">
                {API_SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scopes.has(s)}
                      onChange={() => toggleScope(s)}
                    />
                    <code>{s}</code>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={isPending || !name.trim() || scopes.size === 0}
                onClick={add}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                Create key
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
            Create an API key
          </button>
        )}
    </div>
  );
}
