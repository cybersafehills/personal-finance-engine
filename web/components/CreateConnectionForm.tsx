"use client";

import { useState, useTransition } from "react";
import { createConnection } from "../app/settings/connections/actions";
import { RevealedSecret } from "./RevealedSecret";
import { ShortcutKeyInstructions } from "./ConnectionDetails";
import type { AccountRow } from "../lib/queries";

const PROVIDER_OPTIONS = [
  { value: "mtn_momo", label: "MTN MoMo" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "bank", label: "Bank" },
  { value: "other", label: "Other" },
] as const;

export function CreateConnectionForm({
  accounts,
  ingestEndpointUrl,
}: {
  accounts: AccountRow[];
  ingestEndpointUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<string>("mtn_momo");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  if (revealedSecret) {
    return (
      <RevealedSecret
        secret={revealedSecret}
        onDismiss={() => {
          setRevealedSecret(null);
          setOpen(false);
          setLabel("");
        }}
        instructions={
          <ShortcutKeyInstructions endpointUrl={ingestEndpointUrl} />
        }
      />
    );
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Add an account first — a connection must be bound to one.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        Connect a device
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setErrorMessage(null);
        startTransition(async () => {
          const result = await createConnection(label, provider, accountId);
          if (result.ok) {
            setRevealedSecret(result.secret);
          } else {
            setErrorMessage(result.error);
          }
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Label</span>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. My iPhone"
          required
          autoFocus
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Account</span>
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          required
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Provider</span>
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create connection"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
