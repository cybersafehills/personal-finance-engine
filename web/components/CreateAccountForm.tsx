"use client";

import { useState, useTransition } from "react";
import { createAccount } from "../app/settings/accounts/actions";

const PROVIDER_OPTIONS = [
  { value: "mtn_momo", label: "MTN MoMo" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "bank", label: "Bank" },
  { value: "other", label: "Other" },
] as const;

export function CreateAccountForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string>("mtn_momo");
  const [currency, setCurrency] = useState("RWF");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        Add account
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
          const result = await createAccount(name, provider, currency);
          if (result.ok) {
            setOpen(false);
            setName("");
          } else {
            setErrorMessage(result.error);
          }
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Account name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. MTN MoMo (Primary)"
          required
          autoFocus
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
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

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Currency</span>
        <input
          type="text"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          maxLength={3}
          required
          className="min-h-11 w-24 rounded-control border border-border-strong bg-background px-3 py-2 text-sm uppercase text-text-primary"
        />
      </label>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create account"}
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
