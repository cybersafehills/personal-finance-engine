"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./Badge";
import {
  connectLedger,
  disconnectLedger,
  setLedgerStatus,
  syncLedgerNow,
  updateLedgerAccountMap,
} from "../app/integrations/sync/actions";
import type { ConnectedLedger } from "../lib/integrations/accounting/contract";

type ProviderChoice = { key: string; label: string; configured: boolean };

function statusVariant(
  s: ConnectedLedger["status"],
): "neutral" | "attention" | "positive" {
  if (s === "error") return "attention";
  if (s === "active") return "positive";
  return "neutral";
}

export function LedgerManager({
  ledgers,
  providers,
}: {
  ledgers: ConnectedLedger[];
  providers: ProviderChoice[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState(providers[0]?.key ?? "quickbooks");
  const [mapEditor, setMapEditor] = useState<string | null>(null);
  const [mapText, setMapText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok?: string,
  ) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        if (ok) setNotice(ok);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  function add() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await connectLedger({ name, provider });
      if (result.ok) {
        setName("");
        setAdding(false);
        setNotice(
          "Ledger added. Connect it to authorise access — the provider may not be available on this deployment yet.",
        );
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function openMap(ledger: ConnectedLedger) {
    setError(null);
    setNotice(null);
    setMapEditor(ledger.id);
    setMapText(JSON.stringify(ledger.accountMap ?? {}, null, 2));
  }

  function saveMap(ledgerId: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mapText || "{}");
    } catch {
      setError("The account map must be valid JSON.");
      return;
    }
    run(
      () => updateLedgerAccountMap(ledgerId, parsed),
      "Account map saved.",
    );
    setMapEditor(null);
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

      {ledgers.length === 0 && !adding && (
        <p className="text-sm text-text-muted">No accounting ledgers connected.</p>
      )}

      <ul className="flex flex-col gap-2">
        {ledgers.map((ledger) => (
          <li
            key={ledger.id}
            className="rounded-card border border-border-subtle bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  {ledger.name}
                </span>
                <span className="block text-xs text-text-muted">
                  {ledger.provider ?? "unknown"} · OneLedger → external books ·{" "}
                  {Object.keys(ledger.accountMap ?? {}).length} account
                  {Object.keys(ledger.accountMap ?? {}).length === 1 ? "" : "s"} mapped
                </span>
              </span>
              <Badge variant={statusVariant(ledger.status)}>{ledger.status}</Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {ledger.provider && ledger.status === "needs_auth" && (
                <a
                  href={`/api/integrations/oauth/${ledger.provider}/start?destination_id=${ledger.destinationId}`}
                  className="font-medium text-accent hover:underline"
                >
                  Connect (coming soon)
                </a>
              )}
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => syncLedgerNow(ledger.id),
                    "Sync recorded.",
                  )}
                className="font-medium text-accent hover:underline disabled:opacity-50"
              >
                Sync now
              </button>
              <button
                type="button"
                disabled={isPending || ledger.status === "disconnected"}
                onClick={() =>
                  run(() =>
                    setLedgerStatus(
                      ledger.id,
                      ledger.status === "paused" ? "active" : "paused",
                    )
                  )}
                className="font-medium text-text-secondary hover:underline disabled:opacity-50"
              >
                {ledger.status === "paused" ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => openMap(ledger)}
                className="font-medium text-text-secondary hover:underline disabled:opacity-50"
              >
                Edit account map
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(() => disconnectLedger(ledger.id), "Ledger disconnected.")}
                className="font-medium text-attention hover:underline disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>

            {mapEditor === ledger.id && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-text-muted">
                  Account map — JSON, e.g. {"{ \"category:Meals\": \"4000\" }"}
                </label>
                <textarea
                  value={mapText}
                  onChange={(e) => setMapText(e.target.value)}
                  rows={6}
                  className="mt-1 block w-full rounded-md border border-border-subtle bg-background px-3 py-2 font-mono text-sm"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => saveMap(ledger.id)}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapEditor(null)}
                    className="rounded-md px-3 py-1.5 text-sm font-medium text-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
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
            <label className="mt-3 block text-sm font-medium text-text-secondary">
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="mt-1 block w-full rounded-md border border-border-subtle bg-background px-3 py-2 text-base"
              >
                {providers.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                    {p.configured ? "" : " (coming soon)"}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={isPending || !name.trim()}
                onClick={add}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                Add ledger
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
            Connect a ledger
          </button>
        )}
    </div>
  );
}
